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

const APP_VERSION = "3.2.5";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// -----------------------------
// Helpers
// -----------------------------
function normalizeId(str = ""){
  return String(str||"").replace(/\D/g, "").trim();
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
  if(!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { role, fullName, email, password } = parsed.data;

  const emailNorm = String(email||"").trim().toLowerCase();

  if(role === "CANDIDATE"){
    const dniRaw = (parsed.data.dni || "").trim();
    const dni = normalizeId(dniRaw);
    const fullNameNorm = normalizeName(fullName);

    if(!dni) return res.status(400).json({ error: "Falta DNI" });

    const address = (parsed.data.address || "").trim();
    const city = (parsed.data.city || "").trim();
    const phone = (parsed.data.phone || "").trim();
    if(!address) return res.status(400).json({ error: "Falta Dirección" });
    if(!city) return res.status(400).json({ error: "Falta Localidad" });
    if(!phone) return res.status(400).json({ error: "Falta Teléfono" });

    // validar DNI único si ya está cargado
    const existingDni = await prisma.profile.findFirst({ where: { dni } });
    if(existingDni) return res.status(409).json({ error: "Ese DNI ya está registrado" });

    const passHash = await bcrypt.hash(password, 10);

    try{
      const user = await prisma.user.create({
        data: {
          email: emailNorm,
          passHash,
          role,
          profile: { create: { fullName, fullNameNorm, dni, address, city, phone } },
          resume: { create: {} }
        }
      });
      return res.json({ ok:true, token: signToken(user), role: user.role });
    }catch(err){
      return res.status(409).json({ error: "Email ya registrado" });
    }
  }

  // COMPANY
  const companyName = (parsed.data.companyName || "").trim();
  const companyNameNorm = normalizeName(companyName);
  const contactNameNorm = normalizeName(fullName);

  const cuitRaw = (parsed.data.cuit || "").trim();
  const cuit = normalizeId(cuitRaw);
  if(!companyName) return res.status(400).json({ error: "Falta Empresa" });
  if(!cuit) return res.status(400).json({ error: "Falta CUIT" });

  const address = (parsed.data.address || "").trim();
  const city = (parsed.data.city || "").trim();
  const phone = (parsed.data.phone || "").trim();
  if(!address) return res.status(400).json({ error: "Falta Dirección" });
  if(!city) return res.status(400).json({ error: "Falta Localidad" });
  if(!phone) return res.status(400).json({ error: "Falta Teléfono" });

  const existingCuit = await prisma.companyProfile.findFirst({ where: { cuit } });
  if(existingCuit) return res.status(409).json({ error: "Ese CUIT ya está registrado" });

  const passHash = await bcrypt.hash(password, 10);

  try{
    const user = await prisma.user.create({
      data: {
        email: emailNorm,
        passHash,
        role,
        companyProfile: {
          create: {
            companyName,
            cuit,
            contactName: fullName,
            contactEmail: emailNorm,
            address,
            city,
            phone
          }
        }
      }
    });
    return res.json({ ok:true, token: signToken(user), role: user.role });
  }catch{
    return res.status(409).json({ error: "Email ya registrado" });
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
    const fullNameNorm = normalizeName(fullName);

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
  // Heurística simple: detecta secciones por palabras clave
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
    if(/\b(educacion|formacion|estudios)\b/.test(s)) return "education";
    if(/\b(certificaciones|cursos|habilitaciones)\b/.test(s)) return "certifications";
    if(/\b(observaciones|otros|adicional)\b/.test(s)) return "observations";
    return null;
  };

  for(const line of lines){
    const k = pick(line);
    if(k) current = k;
    buckets[current] += line + "\n";
  }

  // limpieza
  for(const k of Object.keys(buckets)){
    buckets[k] = buckets[k].trim();
  }

  return buckets;
}

async function extractTextFromUpload(file){
  const name = String(file.originalname || "").toLowerCase();
  const buf = file.buffer;
  if(name.endsWith(".txt")){
    return buf.toString("utf-8");
  }
  if(name.endsWith(".pdf")){
    const data = await pdfParse(buf);
    return data?.text || "";
  }
  if(name.endsWith(".docx")){
    const res = await mammoth.extractRawText({ buffer: buf });
    return res?.value || "";
  }
  // fallback: intentar como texto
  try{ return buf.toString("utf-8"); } catch { return ""; }
}

app.post("/resume/parse", auth, upload.single("file"), async (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: "Falta adjuntar archivo (PDF/DOCX/TXT)." });
    const text = await extractTextFromUpload(req.file);
    if(!text || text.trim().length < 20){
      return res.status(400).json({ error: "No pudimos leer texto del archivo. Probá con PDF/DOCX/TXT que contenga texto seleccionable." });
    }
    const sections = splitByHeadings(text);
    return res.json({ ok:true, sections });
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
