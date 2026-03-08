import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Version única (proviene de package.json cuando se ejecuta vía `npm start`)
const APP_VERSION = process.env.npm_package_version || "dev";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// -----------------------------
// Helpers
// -----------------------------
function normalizeId(str = ""){
  return String(str||"").replace(/\D/g, "").trim();
}

function normalizeEmail(email = ""){
  return String(email||"").trim().toLowerCase();
}

function normalizeName(str = ""){
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a = "", b = ""){
  const m = a.length, n = b.length;
  if(m === 0) return n;
  if(n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0] = i;
  for(let j=0;j<=n;j++) dp[0][j] = j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b){
  const A = normalizeName(a);
  const B = normalizeName(b);
  const maxLen = Math.max(A.length, B.length);
  if(maxLen === 0) return 1;
  const dist = levenshtein(A, B);
  return 1 - (dist / maxLen);
}

function signToken(user){
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next){
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if(!token) return res.status(401).json({ error: "Falta token" });
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  }catch{
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Alias para evitar errores por renombre en rutas
const authRequired = auth;

// Usuario actual
app.get("/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { candidateProfile: true, company: true },
    });
    if (!user) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      fullName: user.candidateProfile?.fullName || null,
      companyName: user.company?.companyName || null,
      profile: user.candidateProfile ? {
        fullName: user.candidateProfile.fullName || null,
        dni: user.candidateProfile.dni || null,
        phone: user.candidateProfile.phone || null,
        city: user.candidateProfile.city || null,
        address: user.candidateProfile.address || null,
      } : null,
    });
  } catch (err) {
    console.error("GET /me", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

function requireRole(role){
  return (req, res, next) => {
    if(req.user?.role !== role) return res.status(403).json({ error: "No autorizado" });
    next();
  };
}

app.get("/health", (_, res) => res.json({ ok:true, service:"talento-pyme-api", version: APP_VERSION }));

// -----------------------------
// Auth (solo CANDIDATE / COMPANY)
// -----------------------------
const registerSchema = z.object({
  role: z.enum(["CANDIDATE", "COMPANY"]),
  fullName: z.string().min(3).max(120),
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
  dni: z.string().max(20).optional(),
  companyName: z.string().max(160).optional(),
  cuit: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  phone: z.string().max(60).optional()
});

const loginSchema = z.object({
  fullName: z.string().min(2).max(120),
  password: z.string().min(8).max(200),
  roleHint: z.enum(["CANDIDATE", "COMPANY"]).optional()
});

const resetByIdSchema = z.object({
  role: z.enum(["CANDIDATE", "COMPANY"]),
  dni: z.string().max(20).optional(),
  cuit: z.string().max(40).optional(),
  newPassword: z.string().min(8).max(200)
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const {
    role,
    fullName,
    email,
    password,
    dni,
    cuit,
    companyName,
    contactName,
    contactEmail,
    phone,
    address,
    city,
    province,
  } = parsed.data;

  const emailNorm = normalizeEmail(email);
  const passHash = await bcrypt.hash(password, 10);

  // Validaciones de identidad (DNI/CUIT) y unicidad
  if (role === "CANDIDATE") {
    const dniNorm = normalizeId(dni || "");
    if (!dniNorm) return res.status(400).json({ error: "DNI requerido" });

    const existingByDni = await prisma.profile.findUnique({ where: { dni: dniNorm } });
    if (existingByDni) return res.status(409).json({ error: "Ya existe un candidato con ese DNI" });
  }

  if (role === "COMPANY") {
    const cuitNorm = normalizeId(cuit || "");
    if (!cuitNorm) return res.status(400).json({ error: "CUIT requerido" });

    const existingByCuit = await prisma.companyProfile.findUnique({ where: { cuit: cuitNorm } });
    if (existingByCuit) return res.status(409).json({ error: "Ya existe una empresa con ese CUIT" });
  }

  // Si el email ya existe, permitimos "completar" el registro
  // (caso típico: versiones anteriores crearon el usuario pero no el perfil por mismatch de schema/código)
  const existingUser = await prisma.user.findUnique({
    where: { email: emailNorm },
    include: { candidateProfile: true, company: true, resume: true },
  });

  if (existingUser) {
    if (existingUser.role !== role) {
      return res.status(409).json({ error: "Ese email ya está registrado con otro perfil" });
    }

    if (role === "CANDIDATE" && !existingUser.candidateProfile) {
      const dniNorm = normalizeId(dni || "");
      const fullNameNorm = normalizeName(fullName || "");

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passHash,
          candidateProfile: {
            create: {
              fullName,
              fullNameNorm,
              dni: dniNorm,
              phone: phone || "",
              address: address || "",
              city: city || "",
              province: province || "",
            },
          },
          ...(existingUser.resume ? {} : { resume: { create: {} } }),
        },
      });

      return res.json({ ok: true, upgraded: true, version: APP_VERSION });
    }

    if (role === "COMPANY" && !existingUser.company) {
      const cuitNorm = normalizeId(cuit || "");
      const companyNameNorm = normalizeName(companyName || "");
      const contactNameNorm = normalizeName(contactName || "");

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passHash,
          company: {
            create: {
              companyName,
              companyNameNorm,
              cuit: cuitNorm,
              contactName: contactName || "",
              contactNameNorm,
              contactEmail: contactEmail || emailNorm,
              phone: phone || "",
              address: address || "",
              city: city || "",
              province: province || "",
            },
          },
          ...(existingUser.resume ? {} : { resume: { create: {} } }),
        },
      });

      return res.json({ ok: true, upgraded: true, version: APP_VERSION });
    }

    return res.status(409).json({ error: "Email ya registrado" });
  }

  // Alta normal
  try {
    if (role === "CANDIDATE") {
      const dniNorm = normalizeId(dni || "");
      const fullNameNorm = normalizeName(fullName || "");

      const user = await prisma.user.create({
        data: {
          email: emailNorm,
          passHash,
          role,
          candidateProfile: {
            create: {
              fullName,
              fullNameNorm,
              dni: dniNorm,
              phone: phone || "",
              address: address || "",
              city: city || "",
              province: province || "",
            },
          },
          resume: { create: {} },
        },
      });

      return res.json({ ok: true, userId: user.id, version: APP_VERSION });
    }

    if (role === "COMPANY") {
      const cuitNorm = normalizeId(cuit || "");
      const companyNameNorm = normalizeName(companyName || "");
      const contactNameNorm = normalizeName(contactName || "");

      const user = await prisma.user.create({
        data: {
          email: emailNorm,
          passHash,
          role,
          company: {
            create: {
              companyName,
              companyNameNorm,
              cuit: cuitNorm,
              contactName: contactName || "",
              contactNameNorm,
              contactEmail: contactEmail || emailNorm,
              phone: phone || "",
              address: address || "",
              city: city || "",
              province: province || "",
            },
          },
          resume: { create: {} },
        },
      });

      return res.json({ ok: true, userId: user.id, version: APP_VERSION });
    }

    return res.status(400).json({ error: "Rol inválido" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error registrando usuario" });
  }
});

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fullName, password, roleHint } = parsed.data;

  const identifier = fullName.trim();

  // Soporte: si el usuario pega su email, permitimos login directo por email (más robusto).
  if(identifier.includes("@")){
    const emailTry = identifier.toLowerCase();
    const u = await prisma.user.findFirst({ where: { email: { equals: emailTry, mode: "insensitive" } } });
    if(!u) return res.status(401).json({ error: "No encontramos ese email. Verificá cómo te registraste." });
    const ok = await bcrypt.compare(password, u.passHash);
    if(!ok) return res.status(401).json({ error: "Clave incorrecta" });
    return res.json({ token: signToken(u), role: u.role });
  }

  const nameNorm = normalizeName(identifier);
  const firstToken = nameNorm.split(" ")[0] || nameNorm;

  // buscar candidatos/empresas por token (y opcionalmente limitar por rol)
  const candPromise = (roleHint === "COMPANY")
    ? Promise.resolve([])
    : prisma.profile.findMany({
        where: { OR: [
          { fullNameNorm: { contains: firstToken, mode: "insensitive" } },
          { fullName: { contains: identifier, mode: "insensitive" } }
        ] },
        include: { user: true },
        take: 50
      });

  const compPromise = (roleHint === "CANDIDATE")
    ? Promise.resolve([])
    : prisma.companyProfile.findMany({
        where: {
          OR: [
            { contactNameNorm: { contains: firstToken, mode: "insensitive" } },
            { companyNameNorm: { contains: firstToken, mode: "insensitive" } },
            { contactName: { contains: identifier, mode: "insensitive" } },
            { companyName: { contains: identifier, mode: "insensitive" } }
          ]
        },
        include: { user: true },
        take: 50
      });

  const [cand, comp] = await Promise.all([candPromise, compPromise]);

  const candidates = [];
  for(const p of cand){
    candidates.push({
      kind: "CANDIDATE",
      displayName: p.fullName || "",
      user: p.user,
      score: similarity(identifier, p.fullName || "")
    });
  }
  for(const c of comp){
    const sContact = similarity(identifier, c.contactName || "");
    const sCompany = similarity(identifier, c.companyName || "");
    candidates.push({
      kind: "COMPANY",
      displayName: c.companyName || c.contactName || "",
      user: c.user,
      score: Math.max(sContact, sCompany)
    });
  }

  // fallback: si no encontramos por token, intentar contains global (insensitive)
  if(candidates.length === 0 && nameNorm.length >= 4){
    const cand2Promise = (roleHint === "COMPANY")
      ? Promise.resolve([])
      : prisma.profile.findMany({ where: { OR: [ { fullNameNorm: { contains: normalizeName(identifier), mode: "insensitive" } }, { fullName: { contains: identifier, mode: "insensitive" } } ] }, include: { user: true }, take: 50 });

    const comp2Promise = (roleHint === "CANDIDATE")
      ? Promise.resolve([])
      : prisma.companyProfile.findMany({
          where: {
            OR: [
              { contactNameNorm: { contains: normalizeName(identifier), mode: "insensitive" } },
              { companyNameNorm: { contains: normalizeName(identifier), mode: "insensitive" } },
              { contactName: { contains: identifier, mode: "insensitive" } },
              { companyName: { contains: identifier, mode: "insensitive" } }
            ]
          },
          include: { user: true },
          take: 50
        });

    const [cand2, comp2] = await Promise.all([cand2Promise, comp2Promise]);

    for(const p of cand2){
      candidates.push({ kind:"CANDIDATE", displayName:p.fullName||"", user:p.user, score: similarity(identifier, p.fullName||"") });
    }
    for(const c of comp2){
      const sContact = similarity(identifier, c.contactName||"");
      const sCompany = similarity(identifier, c.companyName||"");
      candidates.push({ kind:"COMPANY", displayName:(c.companyName||c.contactName||""), user:c.user, score: Math.max(sContact, sCompany) });
    }
  }

  // 3er fallback (especial para registros recientes): buscar en los últimos perfiles por si hay tildes/puntos o no existe fullNameNorm aún
  if(candidates.length === 0 && nameNorm.length >= 4){
    const take = 200;

    if(roleHint !== "COMPANY"){
      const recentCand = await prisma.profile.findMany({
        include: { user: true },
        orderBy: { updatedAt: "desc" },
        take
      });
      for(const p of recentCand){
        candidates.push({ kind:"CANDIDATE", displayName:p.fullName||"", user:p.user, score: similarity(identifier, p.fullName||"") });
      }
    }

    if(roleHint !== "CANDIDATE"){
      const recentComp = await prisma.companyProfile.findMany({
        include: { user: true },
        orderBy: { updatedAt: "desc" },
        take
      });
      for(const c of recentComp){
        const sContact = similarity(identifier, c.contactName||"");
        const sCompany = similarity(identifier, c.companyName||"");
        candidates.push({ kind:"COMPANY", displayName:(c.companyName||c.contactName||""), user:c.user, score: Math.max(sContact, sCompany) });
      }
    }
  }

  if(candidates.length === 0){
    return res.status(401).json({ error: "No encontramos ese nombre. Verificá cómo te registraste." });
  }

  candidates.sort((a,b) => b.score - a.score);
  const best = candidates[0];

  // criterio 70%
  if(best.score < 0.70){
    return res.status(401).json({ error: "Nombre no coincide lo suficiente (mínimo 70%). Probá escribir tu nombre completo." });
  }

  // si hay otro muy cerca (ambigüedad), pedimos más precisión
  const second = candidates[1];
  if(second && (best.score - second.score) < 0.03 && second.score >= 0.70){
    return res.status(409).json({ error: "Nombre ambiguo. Escribí el nombre completo (incluyendo segundo nombre y apellido) para ingresar." });
  }

  const ok = await bcrypt.compare(password, best.user.passHash);
  if(!ok) return res.status(401).json({ error: "Clave incorrecta" });

  return res.json({ token: signToken(best.user), role: best.user.role });
});

app.post("/auth/reset-by-id", async (req, res) => {
  const parsed = resetByIdSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { role, newPassword } = parsed.data;
  const passHash = await bcrypt.hash(newPassword, 10);

  if(role === "CANDIDATE"){
    const dniRaw = (parsed.data.dni || "").trim();
    const dni = normalizeId(dniRaw);
  
    if(!dni) return res.status(400).json({ error: "Falta DNI" });

    const p = await prisma.profile.findFirst({ where: { OR: [ { dni }, { dni: dniRaw } ] }, include: { user: true } });
    if(!p?.user) return res.status(404).json({ error: "No encontramos un usuario con ese DNI" });

    await prisma.user.update({ where: { id: p.user.id }, data: { passHash } });
    return res.json({ ok:true });
  }

  const cuitRaw = (parsed.data.cuit || "").trim();
  const cuit = normalizeId(cuitRaw);
  if(!cuit) return res.status(400).json({ error: "Falta CUIT" });

  const c = await prisma.companyProfile.findFirst({ where: { OR: [ { cuit }, { cuit: cuitRaw } ] }, include: { user: true } });
  if(!c?.user) return res.status(404).json({ error: "No encontramos una empresa con ese CUIT" });

  await prisma.user.update({ where: { id: c.user.id }, data: { passHash } });
  return res.json({ ok:true });
});

// -----------------------------
// Profile (candidato)
// -----------------------------
const profileSchema = z.object({
  fullName: z.string().max(120).optional().nullable(),
  dni: z.string().max(20).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  province: z.string().max(80).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  headline: z.string().max(140).optional().nullable(),
  sector: z.string().max(80).optional().nullable(),
  subSector: z.string().max(120).optional().nullable(),
  skillsText: z.string().max(8000).optional().nullable()
});


const bolsaSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  dni: z.string().min(4).max(20),
  nacionalidad: z.string().max(80),
  estadoCivil: z.string().max(40),
  hijos: z.string().max(40),
  telefono: z.string().max(40),
  correo: z.string().email().max(160),
  localidad: z.string().max(80),
  direccion: z.string().max(160).optional().nullable(),

  areaTrabajo: z.string().max(80),
  nivel: z.string().max(80).optional().nullable(),
  especialidad: z.string().max(120),
  especialidadOtro: z.string().max(120).optional().nullable(),

  rangoExperiencia: z.string().max(80),
  nivelEducativo: z.string().max(80),
  tieneCapacitacion: z.boolean(),
  trabajaActualmente: z.boolean(),
  sueldoPretendido: z.string().max(80).optional().nullable(),
  ultimoTrabajo: z.string().max(140).optional().nullable(),
  observaciones: z.string().max(2000).optional().nullable(),

  herramientasMecanica: z.array(z.string().max(120)).optional().nullable(),
  instrumentosElectrica: z.array(z.string().max(120)).optional().nullable(),
});

function parseSkills(skillsText){
  const rows = String(skillsText || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const skills = [];
  for(const row of rows){
    const parts = row.split("|").map(x=>x.trim()).filter(Boolean);
    const name = parts[0];
    let level = null;
    if(parts[1]){
      const n = parseInt(parts[1],10);
      if(!isNaN(n)) level = Math.max(1, Math.min(5, n));
    }
    if(name) skills.push({ name, level });
  }
  return skills;
}

app.get("/profile/me", auth, async (req, res) => {
  const p = await prisma.profile.findUnique({ where: { userId: req.user.id }, include: { skills: true } });
  res.json(p || null);
});

app.put("/profile/me", auth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { skillsText, ...rest } = parsed.data;

  if(rest.fullName) rest.fullNameNorm = normalizeName(rest.fullName);
  if(rest.dni) rest.dni = normalizeId(rest.dni);

  // si manda DNI, verificar unicidad
  if(rest.dni){
    const other = await prisma.profile.findFirst({ where: { dni: rest.dni, NOT: { userId: req.user.id } } });
    if(other) return res.status(409).json({ error: "Ese DNI ya está registrado" });
  }

  const p = await prisma.profile.upsert({
    where: { userId: req.user.id },
    update: rest,
    create: { userId: req.user.id, ...rest }
  });

  if (skillsText !== undefined) {
    await prisma.skill.deleteMany({ where: { profileId: p.id } });
    const skills = parseSkills(skillsText);
    if (skills.length) {
      await prisma.skill.createMany({ data: skills.map(s => ({ profileId: p.id, name: s.name, level: s.level })) });
    }
  }

  const p2 = await prisma.profile.findUnique({ where: { userId: req.user.id }, include: { skills: true } });
  res.json(p2);
});

// -----------------------------
// Resume + Parse
// -----------------------------
const resumeSchema = z.object({
  summary: z.string().max(12000).optional().nullable(),
  experience: z.string().max(20000).optional().nullable(),
  education: z.string().max(12000).optional().nullable(),
  certifications: z.string().max(12000).optional().nullable(),
  observations: z.string().max(12000).optional().nullable()
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }
});

function splitByHeadings(text){
  const t = String(text || "");
  const buckets = {
    summary: "",
    experience: "",
    education: "",
    certifications: "",
    observations: ""
  };

  const lines = t.split(/\r?\n/);
  let current = "summary";

  const pick = (line) => {
    const s = normalizeName(line);
    if(/\b(resumen|perfil|objetivo)\b/.test(s)) return "summary";
    if(/\b(experiencia|trayectoria|antecedentes)\b/.test(s)) return "experience";
    if(/\b(educacion|formacion academica|formacion|estudios)\b/.test(s)) return "education";
    if(/\b(certificaciones|formacion complementaria|cursos|habilitaciones|competencias clave)\b/.test(s)) return "certifications";
    if(/\b(observaciones|otros|adicional)\b/.test(s)) return "observations";
    return null;
  };

  for(const line of lines){
    const k = pick(line);
    if(k) current = k;
    buckets[current] += line + "\n";
  }

  for(const k of Object.keys(buckets)) buckets[k] = buckets[k].trim();
  return buckets;
}

function normalizeSpaces(v=""){
  return String(v || "").replace(/\s+/g, " ").trim();
}

function cleanTextForAnalysis(text){
  return String(text || "")
    .replace(/[•·]/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function splitLinesStrong(v = ""){
  return cleanTextForAnalysis(v)
    .split(/\n+/)
    .map(x => normalizeSpaces(x))
    .filter(Boolean);
}

function uniq(arr){
  return [...new Set((arr || []).filter(Boolean))];
}

function pickSectionText(sections, keys){
  return keys.map(k => sections?.[k] || "").join("\n").trim();
}

function extractExperienceEntries(text, sections){
  const src = pickSectionText(sections, ["experience"]) || text || "";
  const lines = splitLinesStrong(src);
  const entries = [];
  let current = null;

  const looksHeader = (line) => {
    if(!/\|/.test(line)) return false;
    if(/linkedin|hotmail|gmail|@/i.test(line)) return false;
    if(/^(formacion|certificaciones|competencias clave)/i.test(line)) return false;
    return true;
  };

  const parseHeader = (line) => {
    const parts = line.split("|").map(s => normalizeSpaces(s));
    const employer = parts[0] || "";
    const role = parts.slice(1).join(" | ") || employer;
    return { employer, role };
  };

  const looksDateLocation = (line) => /((19|20)\d{2}|presente|actualidad|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(line);
  const extractYears = (line) => Array.from(line.matchAll(/(?:19|20)\d{2}/g)).map(m => Number(m[0]));

  for(const line of lines){
    if(looksHeader(line)){
      if(current) entries.push(current);
      const hdr = parseHeader(line);
      current = {
        employer: hdr.employer,
        role: hdr.role,
        header: line,
        dateLine: "",
        location: "",
        bullets: []
      };
      continue;
    }

    if(current && !current.dateLine && looksDateLocation(line)){
      current.dateLine = line;
      const locMatch = line.match(/\|\s*([^|]+)$/);
      current.location = locMatch ? normalizeSpaces(locMatch[1]) : "";
      current.years = extractYears(line);
      continue;
    }

    if(current){
      current.bullets.push(line);
    }
  }
  if(current) entries.push(current);

  return entries.map((e, idx) => ({
    ...e,
    sortYear: (e.years && e.years.length ? Math.max(...e.years) : (3000 - idx))
  })).sort((a,b)=> b.sortYear - a.sortYear);
}

function detectProfession(text, sections, entries){
  const haySummary = normalizeName(pickSectionText(sections, ["summary"]));
  const hayExp = normalizeName(pickSectionText(sections, ["experience"]));
  const recent = entries?.[0] || null;
  const roleText = normalizeName(`${recent?.role || ""} ${recent?.header || ""} ${haySummary}`);

  const profiles = [
    [/planificacion de mantenimiento|mantenimiento y confiabilidad|lider de planificacion de mantenimiento/i, "Especialista en planificación de mantenimiento y confiabilidad"],
    [/gestion de activos|confiabilidad operativa|mantenimiento centrado en confiabilidad/i, "Especialista en confiabilidad operativa y gestión de activos"],
    [/jefe de operaciones|operacion de planta|produccion/i, "Profesional senior en operaciones industriales y mantenimiento"],
    [/gestion de proyectos de inversion|project manager|proyectos industriales/i, "Profesional senior en proyectos industriales y mantenimiento"],
    [/mantenimiento industrial|planner de ingenieria y mantenimiento|jefe de mantenimiento/i, "Profesional senior en mantenimiento industrial"],
    [/tecnico comercial|representante tecnico comercial/i, "Profesional técnico-comercial industrial"],
    [/instrumentista|automatizacion y control/i, "Técnico senior en automatización, control y mantenimiento"],
  ];

  for(const [rx, label] of profiles){
    if(rx.test(roleText) || rx.test(hayExp)) return label;
  }

  if(/profesional senior/.test(haySummary)) return "Profesional senior en mantenimiento, confiabilidad y gestión de activos";
  return "Perfil técnico-industrial senior";
}

function detectYearsExperience(text, sections, entries){
  const hay = `${text || ""}
${sections?.summary || ""}
${sections?.experience || ""}`;
  const patterns = [
    /mas de\s+(\d{1,2})\s+anos\s+de\s+experiencia/gi,
    /más de\s+(\d{1,2})\s+años\s+de\s+experiencia/gi,
    /trayectoria de\s+(\d{1,2})\s+anos/gi,
    /trayectoria de\s+(\d{1,2})\s+años/gi,
  ];
  const nums = [];
  for (const rx of patterns){
    for(const m of hay.matchAll(rx)) nums.push(Number(m[1]));
  }
  const years = [];
  for(const e of (entries || [])){
    for(const y of (e.years || [])) years.push(Number(y));
  }
  if(years.length >= 2){
    const span = Math.max(...years) - Math.min(...years);
    if(Number.isFinite(span) && span > 0) nums.push(span);
  }
  return nums.length ? Math.max(...nums) : null;
}

function escapeRegExp(s=""){function escapeRegExp(s=""){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectCoreSkills(text, sections, entries){
  const hay = normalizeName(`${text || ""}\n${sections?.summary || ""}\n${sections?.experience || ""}\n${sections?.certifications || ""}`);
  const skillMap = [
    ["planificación de mantenimiento", ["planificacion de mantenimiento", "lider de planificacion", "planner de ingenieria y mantenimiento"]],
    ["confiabilidad operativa", ["confiabilidad operativa", "confiabilidad", "gestion de activos"]],
    ["SAP PM/MM/PS", ["sap pm", "sap mm", "sap ps", "sap owner", "sap"]],
    ["mantenimiento industrial", ["mantenimiento industrial", "mantenimiento", "jefe de mantenimiento"]],
    ["proyectos industriales", ["gestion de proyectos", "project management", "proyectos de inversion", "administrador de capital"]],
    ["mejora continua", ["mejora continua", "six sigma", "tpm", "rcm", "smed", "idcon"]],
    ["liderazgo técnico", ["liderazgo", "equipos multidisciplinarios", "gerenciamiento de personas", "conformacion y desarrollo del equipo"]],
    ["operaciones de planta", ["jefe de operaciones", "operacion de planta", "produccion"]],
    ["automatización y control", ["automatizacion", "control", "instrumentista"]],
    ["supply chain y abastecimiento", ["supply chain", "almacen", "repuestos", "abastecimiento"]],
  ];
  const scores = [];
  for (const [label, terms] of skillMap){
    let score = 0;
    for (const term of terms){
      const rx = new RegExp(escapeRegExp(term), "gi");
      const matches = hay.match(rx);
      if (matches) score += matches.length;
    }
    if (score > 0) scores.push({ label, score });
  }
  return scores.sort((a,b)=>b.score-a.score).slice(0,8).map(s=>s.label);
}

function detectCareerStrengths(text, sections){
  const hay = normalizeName(`${text || ""}\n${sections?.summary || ""}\n${sections?.experience || ""}`);
  const strengths = [];
  if(/planificacion/.test(hay)) strengths.push("planificación y organización del mantenimiento");
  if(/confiabilidad|gestion de activos/.test(hay)) strengths.push("confiabilidad operativa y gestión de activos");
  if(/equipos multidisciplinarios|liderazgo/.test(hay)) strengths.push("liderazgo de equipos técnicos multidisciplinarios");
  if(/sap/.test(hay)) strengths.push("uso intensivo de SAP como plataforma de gestión industrial");
  if(/predictiv|preventiv/.test(hay)) strengths.push("diseño de estrategias predictivas y preventivas");
  if(/proyectos|inversion/.test(hay)) strengths.push("gestión de proyectos industriales e inversiones");
  if(/mejora continua|six sigma|tpm|rcm|smed|idcon/.test(hay)) strengths.push("mejora continua y metodologías de excelencia operativa");
  return strengths.slice(0,6);
}

function detectIndustries(entries, text, sections){
  const hay = normalizeName(`${text || ""}\n${sections?.summary || ""}\n${sections?.experience || ""}`);
  const found = [];
  const map = [
    [/softys|papel|conversion de papel|rollos|doblados/, "papel y conversión"],
    [/agroquimica|dva argentina|monsanto/, "química y agroquímica"],
    [/big dutchman|porcino|cono sur/, "agroindustrial"],
    [/tecno logisti-k|servicios de ingenieria|servicios a industrias/, "servicios industriales"],
  ];
  for(const [rx, label] of map){ if(rx.test(hay)) found.push(label); }
  return uniq(found);
}

function detectCompaniesAndSites(entries){
  const employers = uniq((entries || []).map(e => e.employer).filter(Boolean));
  const sites = [];
  for(const e of (entries || [])){
    if(e.location) sites.push(`${e.employer}: ${e.location}`);
    const full = `${e.header} ${e.dateLine} ${(e.bullets||[]).join(' ')}`;
    const matches = full.match(/planta\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+/gi) || [];
    for(const m of matches) sites.push(`${e.employer}: ${normalizeSpaces(m)}`);
  }
  return { employers: employers.slice(0,10), sites: uniq(sites).slice(0,10) };
}

function detectRecentRoles(entries){
  return (entries || []).slice(0,5).map(e => {
    const bits = [e.role || e.header, e.employer, e.location].filter(Boolean);
    return bits.join(" — ");
  });
}

function optimizeProfessionalSummary(text, sections, analysis){
  const summary = normalizeSpaces(sections?.summary || "");
  const recent = analysis.recentRoles || [];
  const strengths = analysis.strengths || [];
  const skills = analysis.skills || [];
  const industries = analysis.industries || [];
  const employers = analysis.employers || [];
  const sites = analysis.sites || [];
  const years = analysis.yearsExperience;
  const profession = analysis.profession;
  const lines = [];

  let intro = profession || "Perfil técnico-industrial senior";
  if (years) intro += ` con aproximadamente ${years} años de experiencia acumulada`;
  intro += ".";
  lines.push(intro);

  if(summary){
    lines.push(`Síntesis profesional: ${summary.slice(0, 1100)}.`);
  }

  if(recent.length){
    lines.push(`Experiencia reciente y cargos relevantes: ${recent.join(" • ")}.`);
  }

  if(employers.length){
    lines.push(`Empresas donde desarrolló su trayectoria: ${employers.join(", ")}.`);
  }

  if(sites.length){
    lines.push(`Plantas o sedes industriales mencionadas en el CV: ${sites.join(" • ")}.`);
  }

  if(industries.length){
    lines.push(`Sectores industriales detectados: ${industries.join(", ")}.`);
  }

  if(strengths.length){
    lines.push(`Fortalezas principales: ${strengths.join(", ")}.`);
  }

  if(skills.length){
    lines.push(`Habilidades técnicas destacadas: ${skills.join(", ")}.`);
  }

  return lines.join("

").slice(0, 9000);
}

function analyzeResumeText(text, sections){function analyzeResumeText(text, sections){
  const entries = extractExperienceEntries(text, sections);
  const companyData = detectCompaniesAndSites(entries);
  const analysis = {
    entries,
    profession: detectProfession(text, sections, entries),
    yearsExperience: detectYearsExperience(text, sections, entries),
    recentRoles: detectRecentRoles(entries),
    skills: detectCoreSkills(text, sections, entries),
    strengths: detectCareerStrengths(text, sections),
    industries: detectIndustries(entries, text, sections),
    employers: companyData.employers,
    sites: companyData.sites,
  };
  analysis.summary = optimizeProfessionalSummary(text, sections, analysis);
  return analysis;
}

function buildResumeSummary(text, sections, analysis){
  const a = analysis || analyzeResumeText(text, sections);
  const lines = [];
  lines.push(`Perfil detectado: ${a.profession || "Perfil técnico-industrial senior"}`);
  if (a.yearsExperience) lines.push(`Experiencia estimada: +${a.yearsExperience} años`);
  if (a.industries?.length) lines.push(`Industrias detectadas: ${a.industries.join(" | ")}`);
  if (a.employers?.length) lines.push(`Empresas detectadas: ${a.employers.join(" | ")}`);
  if (a.sites?.length) lines.push(`Plantas / sedes mencionadas: ${a.sites.join(" | ")}`);
  if (a.skills?.length) lines.push(`Ranking de habilidades: ${a.skills.map((s, i) => `${i+1}. ${s}`).join(" | ")}`);
  if (a.recentRoles?.length) lines.push(`Cargos recientes detectados: ${a.recentRoles.join(" | ")}`);
  lines.push("");
  lines.push("Resumen profesional optimizado:");
  lines.push(a.summary || "");
  return lines.join("
").trim().slice(0, 9000);
}

async function extractTextFromUpload(file){
  const name = String(file.originalname || "").toLowerCase();
  const buf = file.buffer;
  let raw = "";
  if(name.endsWith(".txt")){
    raw = buf.toString("utf-8");
  }else if(name.endsWith(".pdf")){
    const data = await pdfParse(buf);
    raw = data?.text || "";
  }else if(name.endsWith(".docx")){
    const res = await mammoth.extractRawText({ buffer: buf });
    raw = res?.value || "";
  }else{
    try{ raw = buf.toString("utf-8"); } catch { raw = ""; }
  }
  return cleanTextForAnalysis(collapseSpacedLetters(raw));
}

app.post("/resume/parse", auth, upload.single("file"), async (req, res) => {app.post("/resume/parse", auth, upload.single("file"), async (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: "Falta adjuntar archivo (PDF/DOCX/TXT)." });
    const text = await extractTextFromUpload(req.file);
    if(!text || text.trim().length < 20){
      return res.status(400).json({ error: "No pudimos leer texto del archivo. Probá con PDF, DOCX o TXT que contenga texto seleccionable." });
    }
    const sections = splitByHeadings(text);
    const analysis = analyzeResumeText(text, sections);
    const summaryText = buildResumeSummary(text, sections, analysis);
    return res.json({ ok:true, sections, analysis, summaryText });
  }catch(err){
    console.error("resume/parse error:", err);
    return res.status(500).json({ error: "Error al procesar el archivo." });
  }
});

app.get("/resume/me", auth, async (req, res) => {
  const r = await prisma.resume.findUnique({ where: { userId: req.user.id } });
  res.json(r || null);
});

app.put("/resume/me", auth, async (req, res) => {
  const parsed = resumeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const r = await prisma.resume.upsert({
    where: { userId: req.user.id },
    update: data,
    create: { userId: req.user.id, ...data }
  });
  res.json(r);
});

// -----------------------------
// Company profile
// -----------------------------
const companySchema = z.object({
  companyName: z.string().min(2).max(140),
  cuit: z.string().max(40).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  contactEmail: z.string().email().max(180).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  province: z.string().max(80).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  website: z.string().max(200).optional().nullable()
});

// ============================
// Bolsa de Trabajo (perfil laboral UIC-style)
// ============================

app.get("/bolsa/me", authRequired, async (req, res) => {
  try{
    const bolsa = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id } });
    return res.json({ ok: true, bolsa });
  }catch(err){
    console.error("GET /bolsa/me", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.post("/bolsa/me", authRequired, async (req, res) => {
  try{
    if(req.user.role !== "CANDIDATE"){
      return res.status(403).json({ ok:false, error:"FORBIDDEN_ROLE" });
    }
    const data = bolsaSchema.parse(req.body);

    const existingProfile = await prisma.profile.findUnique({ where: { userId: req.user.id } });
    if(existingProfile?.dni && String(existingProfile.dni) !== String(data.dni)){
      return res.status(400).json({ ok:false, error:"DNI_MISMATCH_WITH_PROFILE" });
    }

    // Keep profile basics in sync (best-effort)
    await prisma.profile.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        fullName: `${data.nombre} ${data.apellido}`.trim(),
        dni: data.dni,
        city: data.localidad,
        address: data.direccion || "",
        phone: data.telefono,
      },
      update: {
        fullName: `${data.nombre} ${data.apellido}`.trim(),
        dni: data.dni,
        city: data.localidad,
        address: data.direccion || "",
        phone: data.telefono,
      }
    });

    const saved = await prisma.candidateBolsa.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        ...data,
        herramientasMecanica: data.herramientasMecanica || [],
        instrumentosElectrica: data.instrumentosElectrica || [],
      },
      update: {
        ...data,
        herramientasMecanica: data.herramientasMecanica || [],
        instrumentosElectrica: data.instrumentosElectrica || [],
      }
    });

    return res.json({ ok:true, bolsa: saved });
  }catch(err){
    if(err?.name === "ZodError"){
      return res.status(400).json({ ok:false, error:"VALIDATION", details: err.errors });
    }
    console.error("POST /bolsa/me", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.get("/bolsa/stats", authRequired, async (req, res) => {
  try{
    const total = await prisma.candidateBolsa.count();
    return res.json({ ok:true, total });
  }catch(err){
    console.error("GET /bolsa/stats", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.get("/bolsa/search", authRequired, async (req, res) => {
  try{
    const q = String(req.query.q || "").trim();
    const area = String(req.query.area || "").trim();
    const nivel = String(req.query.nivel || "").trim();
    const especialidad = String(req.query.especialidad || "").trim();
    const localidad = String(req.query.localidad || "").trim();

    const herr = String(req.query.herr || "").trim();
    const instr = String(req.query.instr || "").trim();

    const where = {};
    if(area) where.areaTrabajo = area;
    if(nivel) where.nivel = nivel;
    if(especialidad) where.especialidad = especialidad;
    if(localidad) where.localidad = localidad;

    if(herr){
      const items = herr.split(",").map(s=>s.trim()).filter(Boolean);
      if(items.length) where.herramientasMecanica = { hasSome: items };
    }
    if(instr){
      const items = instr.split(",").map(s=>s.trim()).filter(Boolean);
      if(items.length) where.instrumentosElectrica = { hasSome: items };
    }

    if(q){
      where.OR = [
        { nombre: { contains: q, mode: "insensitive" } },
        { apellido: { contains: q, mode: "insensitive" } },
        { especialidad: { contains: q, mode: "insensitive" } },
        { observaciones: { contains: q, mode: "insensitive" } },
        { ultimoTrabajo: { contains: q, mode: "insensitive" } },
      ];
    }

    const items = await prisma.candidateBolsa.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id:true,
        nombre:true,
        apellido:true,
        localidad:true,
        telefono:true,
        correo:true,
        areaTrabajo:true,
        nivel:true,
        especialidad:true,
        especialidadOtro:true,
        rangoExperiencia:true,
        nivelEducativo:true,
        tieneCapacitacion:true,
        trabajaActualmente:true,
        sueldoPretendido:true,
        ultimoTrabajo:true,
        observaciones:true,
        herramientasMecanica:true,
        instrumentosElectrica:true,
        updatedAt:true,
      }
    });

    return res.json({ ok:true, items });
  }catch(err){
    console.error("GET /bolsa/search", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});




app.get("/company/me", auth, requireRole("COMPANY"), async (req, res) => {
  const c = await prisma.companyProfile.findUnique({ where: { userId: req.user.id } });
  res.json(c || null);
});

app.put("/company/me", auth, requireRole("COMPANY"), async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = { ...parsed.data };
  if(data.companyName) data.companyNameNorm = normalizeName(data.companyName);
  if(data.contactName) data.contactNameNorm = normalizeName(data.contactName);
  if(data.cuit) data.cuit = normalizeId(data.cuit);

  // si manda CUIT, verificar unicidad
  if(data.cuit){
    const other = await prisma.companyProfile.findFirst({ where: { cuit: data.cuit, NOT: { userId: req.user.id } } });
    if(other) return res.status(409).json({ error: "Ese CUIT ya está registrado" });
  }

  const c = await prisma.companyProfile.upsert({
    where: { userId: req.user.id },
    update: data,
    create: { userId: req.user.id, ...data }
  });
  res.json(c);
});

// -----------------------------
// Categories
// -----------------------------
async function ensureDefaultCategories(){
  const defaults = [
    "Industria y Producción",
    "Mantenimiento y Servicios",
    "Logística y Transporte",
    "Administración",
    "Comercial y Ventas",
    "Tecnología",
    "Hotelería"
  ];

  for(const name of defaults){
    try{ await prisma.jobCategory.create({ data: { name } }); }catch{}
  }
}

app.get("/categories", async (_, res) => {
  await ensureDefaultCategories();
  const cats = await prisma.jobCategory.findMany({ orderBy: { name: "asc" } });
  res.json({ categories: cats });
});

// -----------------------------
// Jobs
// -----------------------------
const jobSchema = z.object({
  title: z.string().min(4).max(140),
  location: z.string().max(120).optional().nullable(),
  modality: z.string().max(60).optional().nullable(),
  description: z.string().min(10).max(12000),
  requirements: z.string().max(8000).optional().nullable(),
  categoryId: z.string().optional().nullable()
});

app.post("/jobs", auth, requireRole("COMPANY"), async (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const c = await prisma.companyProfile.findUnique({ where: { userId: req.user.id } });
  if (!c) return res.status(400).json({ error: "Empresa no configurada" });

  const job = await prisma.job.create({
    data: {
      companyId: c.id,
      createdById: req.user.id,
      title: parsed.data.title,
      location: parsed.data.location ?? null,
      modality: parsed.data.modality ?? null,
      description: parsed.data.description,
      requirements: parsed.data.requirements ?? null,
      categoryId: parsed.data.categoryId ?? null,
      status: "PUBLISHED"
    }
  });

  res.json(job);
});

app.get("/jobs", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const categoryId = String(req.query.categoryId || "").trim();

  const where = { status: "PUBLISHED" };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { requirements: { contains: q, mode: "insensitive" } }
    ];
  }
  if (categoryId) where.categoryId = categoryId;

  const jobs = await prisma.job.findMany({
    where,
    include: { company: true, category: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  res.json({ jobs });
});

app.get("/jobs/mine", auth, requireRole("COMPANY"), async (req, res) => {
  const c = await prisma.companyProfile.findUnique({ where: { userId: req.user.id } });
  if (!c) return res.json({ jobs: [] });
  const jobs = await prisma.job.findMany({ where: { companyId: c.id }, orderBy: { createdAt: "desc" } });
  res.json({ jobs });
});

const applySchema = z.object({ coverNote: z.string().max(4000).optional().nullable() });

app.post("/jobs/:id/apply", auth, requireRole("CANDIDATE"), async (req, res) => {
  const jobId = req.params.id;
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: "Búsqueda no encontrada" });

  try {
    const row = await prisma.application.create({ data: { jobId, userId: req.user.id, coverNote: parsed.data.coverNote ?? null } });
    res.json(row);
  } catch {
    res.status(409).json({ error: "Ya postulaste a esta búsqueda" });
  }
});

// -----------------------------
// Search talent (para empresas, gratis)
// -----------------------------
app.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [] });

  const results = await prisma.profile.findMany({
    where: {
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { headline: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { province: { contains: q, mode: "insensitive" } },
        { skills: { some: { name: { contains: q, mode: "insensitive" } } } },
        {
          user: {
            resume: {
              is: {
                OR: [
                  { summary: { contains: q, mode: "insensitive" } },
                  { experience: { contains: q, mode: "insensitive" } },
                  { observations: { contains: q, mode: "insensitive" } }
                ]
              }
            }
          }
        }
      ]
    },
    include: { skills: true, user: { select: { email: true, role: true } } },
    take: 25
  });

  res.json({ results });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log("Talento PyME API escuchando en", PORT, "(v"+APP_VERSION+")"));
