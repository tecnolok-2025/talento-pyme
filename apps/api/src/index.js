import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import multer from "multer";
import pdfParsePkg from "pdf-parse";
import mammothPkg from "mammoth";

dotenv.config();

const APP_VERSION = "3.0.0";
const JWT_SECRET = JWT_SECRET || "dev-secret";
const SUPERADMIN_CODE = process.env.SUPERADMIN_CODE || "";
const ADMIN_CANDIDATE_CODE = process.env.ADMIN_CANDIDATE_CODE || "";
const ADMIN_COMPANY_CODE = process.env.ADMIN_COMPANY_CODE || "";
const FRONT_URL = process.env.FRONT_URL || "https://talento-pyme.onrender.com";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const pdfParse = pdfParsePkg?.default || pdfParsePkg;
const mammoth = mammothPkg?.default || mammothPkg;

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Falta token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: "Sin permisos" });
    next();
  };
function requireAnyRole(roles=[]) {
  return (req, res, next) => {
    if (!req.user?.role || !roles.includes(req.user.role)) return res.status(403).json({ error: "Sin permisos" });
    next();
  };
}
function isSuperAdminRole(role){
  return role === "SUPERADMIN" || role === "ADMIN";
}

}

app.get("/health", (_, res) => res.json({ ok: true, app: "talento-pyme-api", version: APP_VERSION }));

app.get("/admin/metrics", authMiddleware, requireAnyRole(["SUPERADMIN","ADMIN"]), async (req, res) => {
  const [users, candidates, companies, resumes, jobs, applications] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: { in: ["CANDIDATE","ADMIN_CANDIDATE"] } } }),
    prisma.user.count({ where: { role: { in: ["COMPANY","ADMIN_COMPANY"] } } }),
    prisma.resume.count(),
    prisma.job.count(),
    prisma.application.count()
  ]);
  res.json({ users, candidates, companies, resumes, jobs, applications, version: APP_VERSION });
});


async function ensureDefaultCategories() {
  const existing = await prisma.jobCategory.findFirst();
  if (existing) return;

  const industria = await prisma.jobCategory.create({ data: { name: "Industria" } });
  const servicios = await prisma.jobCategory.create({ data: { name: "Servicios" } });
  const hoteleria = await prisma.jobCategory.create({ data: { name: "Hotelería" } });

  await prisma.jobCategory.createMany({
    data: [
      { name: "Mantenimiento Industrial", parentId: industria.id },
      { name: "Producción", parentId: industria.id },
      { name: "Logística", parentId: servicios.id },
      { name: "Administración", parentId: servicios.id },

      { name: "Recepción", parentId: hoteleria.id },
      { name: "Housekeeping", parentId: hoteleria.id },
      { name: "Cocina", parentId: hoteleria.id },
      { name: "Mantenimiento Hotelero", parentId: hoteleria.id },
      { name: "Eventos & Banquetes", parentId: hoteleria.id }
    ]
  });
}

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8), role: z.enum(["CANDIDATE","COMPANY","ADMIN","ADMIN_CANDIDATE","ADMIN_COMPANY","SUPERADMIN"]), fullName: z.string().min(2).max(120).optional(), companyName: z.string().min(2).max(120).optional(), adminCode: z.string().max(200).optional(), contactName: z.string().min(2).max(120).optional() });

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password, role, fullName, companyName, adminCode, contactName } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "Email ya registrado" });

  if (role === "COMPANY" && !companyName) return res.status(400).json({ error: "companyName requerido para Empresa" });

  const passHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, passHash, role } });

  if (role === "CANDIDATE" || role === "ADMIN_CANDIDATE") {
    await prisma.profile.create({ data: { userId: user.id, fullName: fullName ?? null } }).catch(() => {});
    await prisma.resume.create({ data: { userId: user.id } }).catch(() => {});
  } else if (role === "COMPANY" || role === "ADMIN_COMPANY") {
    await prisma.companyProfile
      .create({ data: { userId: user.id, companyName: companyName, contactName: contactName ?? null } })
      .catch(() => {});
  }

  await ensureDefaultCategories();
  res.json({ id: user.id, email: user.email, role: user.role });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

app.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

  const ok = await bcrypt.compare(parsed.data.password, user.passHash);
  if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });


const forgotSchema = z.object({ email: z.string().email() });
app.post("/auth/forgot", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(404).json({ error: "Email no encontrado" });

  const token = jwt.sign({ sub: user.id, purpose: "reset" }, JWT_SECRET, { expiresIn: "15m" });
  const resetUrl = `${FRONT_URL}/reset.html?token=${encodeURIComponent(token)}`;

  // En plan gratuito no enviamos emails. Devolvemos el link para compartirlo (WhatsApp/Email interno).
  res.json({ ok: true, resetUrl });
});

const resetSchema = z.object({ token: z.string().min(10), newPassword: z.string().min(8) });
app.post("/auth/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  let payload;
  try {
    payload = jwt.verify(parsed.data.token, JWT_SECRET);
  } catch (e) {
    return res.status(400).json({ error: "Token inválido o vencido" });
  }
  if (payload?.purpose !== "reset") return res.status(400).json({ error: "Token inválido" });

  const passHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: payload.sub }, data: { passHash } });

  res.json({ ok: true });
});


  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: user.role });
});

// Candidate profile
const profileSchema = z.object({
  fullName: z.string().max(120).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  province: z.string().max(80).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  headline: z.string().max(160).optional().nullable(),
  sector: z.string().max(60).optional().nullable(),
  subSector: z.string().max(120).optional().nullable(),
  skills: z.array(z.object({ name: z.string().max(60), level: z.number().int().min(1).max(5).optional().nullable() })).optional()
});

app.get("/profile/me", auth, async (req, res) => {
  const p = await prisma.profile.findUnique({ where: { userId: req.user.id }, include: { skills: true } });
  res.json(p || null);
});

app.put("/profile/me", auth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  const p = await prisma.profile.upsert({
    where: { userId: req.user.id },
    update: { fullName: data.fullName ?? undefined, city: data.city ?? undefined, province: data.province ?? undefined, phone: data.phone ?? undefined, headline: data.headline ?? undefined,
      sector: data.sector ?? undefined,
      subSector: data.subSector ?? undefined },
    create: { userId: req.user.id, fullName: data.fullName ?? null, city: data.city ?? null, province: data.province ?? null, phone: data.phone ?? null, headline: data.headline ?? null,
      sector: data.sector ?? null,
      subSector: data.subSector ?? null }
  });

  if (Array.isArray(data.skills)) {
    await prisma.skill.deleteMany({ where: { profileId: p.id } });
    if (data.skills.length) {
      await prisma.skill.createMany({ data: data.skills.map(s => ({ profileId: p.id, name: s.name, level: s.level ?? null })) });
    }
  }

  const fresh = await prisma.profile.findUnique({ where: { id: p.id }, include: { skills: true } });
  res.json(fresh);
});

// Resume
const resumeSchema = z.object({
  summary: z.string().max(4000).optional().nullable(),
  experience: z.string().max(12000).optional().nullable(),
  education: z.string().max(8000).optional().nullable(),
  certifications: z.string().max(6000).optional().nullable(),
  observations: z.string().max(8000).optional().nullable()
});


// --- CV / Resume parsing (PDF/DOCX/TXT) ---
// Devuelve sugerencias para autocompletar campos; el usuario puede editarlas y luego Guardar.
// No almacenamos el archivo: procesamos en memoria y descartamos.
function splitByHeadings(text){
  const t = (text||"").replace(/\r/g,"");
  const markers = [
    {k:"summary", rx:/\b(resumen|perfil profesional|perfil)\b/i},
    {k:"experience", rx:/\b(experiencia|experiencia laboral|historial laboral)\b/i},
    {k:"education", rx:/\b(educaci[oó]n|formaci[oó]n acad[eé]mica|formaci[oó]n)\b/i},
    {k:"certifications", rx:/\b(certificaciones|cursos|capacitaciones|habilitaciones)\b/i},
    {k:"observations", rx:/\b(observaciones|otros|informaci[oó]n adicional)\b/i},
  ];

  // encontrar posiciones
  const found = [];
  markers.forEach(m=>{
    const match = m.rx.exec(t);
    if(match) found.push({k:m.k, idx: match.index});
  });
  found.sort((a,b)=>a.idx-b.idx);

  const out = { summary:"", experience:"", education:"", certifications:"", observations:"" };
  if(found.length===0){
    const lines = t.split("\n").map(s=>s.trim()).filter(Boolean);
    out.summary = lines.slice(0,12).join("\n");
    out.experience = lines.slice(12,120).join("\n");
    out.education = "";
    out.certifications = "";
    out.observations = lines.slice(120).join("\n");
    return out;
  }

  for(let i=0;i<found.length;i++){
    const a = found[i];
    const b = found[i+1];
    const start = a.idx;
    const end = b ? b.idx : t.length;
    const chunk = t.slice(start, end).trim();
    // quitar el heading de la primera línea
    const firstNl = chunk.indexOf("\n");
    const cleaned = (firstNl>0 ? chunk.slice(firstNl+1) : "").trim();
    out[a.k] = cleaned || "";
  }
  return out;
}

async function extractTextFromUpload(file){
  const name = (file?.originalname||"").toLowerCase();
  const buf = file?.buffer;
  if(!buf) return "";
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
    return res.json({ ok:true, ...sections });
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
    update: parsed.data,
    create: { userId: req.user.id, ...parsed.data }
  });
  res.json(r);
});

// Company profile
const companySchema = z.object({
  companyName: z.string().min(2).max(140),
  cuit: z.string().max(20).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  contactEmail: z.string().email().max(160).optional().nullable(),
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
  const c = await prisma.companyProfile.upsert({ where: { userId: req.user.id }, update: parsed.data, create: { userId: req.user.id, ...parsed.data } });
  res.json(c);
});

// Categories
app.get("/categories", async (_, res) => {
  await ensureDefaultCategories();
  const cats = await prisma.jobCategory.findMany({ orderBy: { name: "asc" } });
  res.json({ categories: cats });
});

// Jobs
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

// Search talent (for companies, free for now)
app.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const skill = String(req.query.skill || "").trim();
  const headline = String(req.query.headline || "").trim();
  const city = String(req.query.city || "").trim();
  const province = String(req.query.province || "").trim();
  const sector = String(req.query.sector || "").trim();
  const subSector = String(req.query.subSector || "").trim();

  const AND = [];
  if (city) AND.push({ city: { contains: city, mode: "insensitive" } });
  if (province) AND.push({ province: { contains: province, mode: "insensitive" } });
  if (headline) AND.push({ headline: { contains: headline, mode: "insensitive" } });
  if (sector) AND.push({ sector: { equals: sector } });
  if (subSector) AND.push({ subSector: { contains: subSector, mode: "insensitive" } });
  if (skill) AND.push({ skills: { some: { name: { contains: skill, mode: "insensitive" } } } });
  if (q) {
    AND.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { headline: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { province: { contains: q, mode: "insensitive" } },
        { sector: { contains: q, mode: "insensitive" } },
        { subSector: { contains: q, mode: "insensitive" } },
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
    });
  }

  if (AND.length === 0) return res.json({ results: [] });

  const results = await prisma.profile.findMany({
    where: { AND },
    include: {
      skills: true,
      user: { select: { email: true, role: true, resume: true } }
    },
    take: 50
  });

  res.json({ results });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log("Talento PyME API escuchando en", PORT));
