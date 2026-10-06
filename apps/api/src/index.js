import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { fileURLToPath } from "url";
import { createPaymentProvider, getPaymentConfigFromEnv } from "./services/payments/index.js";
import { assertNoCardData, listForbiddenPaymentFields, sanitizeCheckoutPayloadForLog, sha256Hex, PaymentProviderError, PaymentSecurityError } from "./services/payments/provider.js";
import { buildTraceabilityPdfBuffer, buildTraceabilityReportFilename, buildTraceabilityEmailSubject, buildTraceabilityNarrative } from "./services/traceability-report.js";
import { buildCandidateCvPdfBuffer, buildCandidateCvFilename, buildCandidateSampleCvData } from "./services/candidate-cv.js";
import { inferResidence, isArgentinaProvince, normalizeResidenceForGrouping } from "./services/residence.js";

const prisma = new PrismaClient();
const app = express();
// Render termina TLS en su proxy; no confiar cabeceras en instalaciones directas.
if(process.env.RENDER) app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const PUBLIC_UPLOADS = "/uploads";

app.use(cors({ exposedHeaders:['Content-Disposition'] }));
app.use((req, res, next) => {
  if (req.path.startsWith("/payments/webhook/")) return next();
  return express.json({ limit: "3mb" })(req, res, next);
});
app.use(PUBLIC_UPLOADS, express.static(UPLOADS_DIR, { maxAge: "7d" }));

// Version única (proviene de package.json cuando se ejecuta vía `npm start`)
const APP_VERSION = process.env.TP_APP_VERSION || process.env.npm_package_version || "8.0.7";
const ADMIN_DB_WARNING_MB = Math.max(64, Number(process.env.ADMIN_DB_WARNING_MB || 256));
const ADMIN_DB_CRITICAL_MB = Math.max(ADMIN_DB_WARNING_MB + 32, Number(process.env.ADMIN_DB_CRITICAL_MB || 512));
const ADMIN_INFRA_URL = String(process.env.ADMIN_INFRA_URL || '').trim();
const ADMIN_BACKUP_URL = String(process.env.ADMIN_BACKUP_URL || '').trim();
const ADMIN_UPGRADE_URL = String(process.env.ADMIN_UPGRADE_URL || process.env.ADMIN_INFRA_URL || '').trim();
const ADMIN_BACKUP_MODE = String(process.env.ADMIN_BACKUP_MODE || 'AUTOMATIC').trim().toUpperCase();
const ADMIN_BACKUP_FREQUENCY = String(process.env.ADMIN_BACKUP_FREQUENCY || 'DAILY').trim().toUpperCase();
const ADMIN_BACKUP_RETENTION_DAYS = Math.max(1, Number(process.env.ADMIN_BACKUP_RETENTION_DAYS || 2));
const ADMIN_BACKUP_PROVIDER = String(process.env.ADMIN_BACKUP_PROVIDER || 'EXTERNAL_PROVIDER').trim().toUpperCase();
const BACKUPS_DIR = path.resolve(__dirname, '../backups');
const ADMIN_LOCAL_BACKUP_ENABLED = String(process.env.ADMIN_LOCAL_BACKUP_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADMIN_BACKUP_CHECK_MINUTES = Math.max(15, Number(process.env.ADMIN_BACKUP_CHECK_MINUTES || 60));
const ADMIN_BACKUP_KEEP_FILES = Math.max(1, Number(process.env.ADMIN_BACKUP_KEEP_FILES || ADMIN_BACKUP_RETENTION_DAYS || 2));
const ADMIN_BACKUP_MIN_SAFE_RATIO = Math.min(0.99, Math.max(0.1, Number(process.env.ADMIN_BACKUP_MIN_SAFE_RATIO || 0.8)));
const DEFAULT_PROVIDER_CONSOLE_URL = String(process.env.ADMIN_PROVIDER_CONSOLE_URL || '').trim();

let backupRunPromise = null;
let backupSchedulerStarted = false;

// v7.10.3 · clasificación automática y persistente de candidatos.
// El motor sigue siendo determinístico y basado en evidencia declarada; esta capa solamente
// garantiza que altas, importaciones masivas y cambios de CV queden procesados sin auditoría manual.
const CANDIDATE_CLASSIFICATION_VERSION = '8.0.4';
const CANDIDATE_CLASSIFICATION_AUTO_ENABLED = String(process.env.CANDIDATE_CLASSIFICATION_AUTO_ENABLED || 'true').trim().toLowerCase() !== 'false';
const CANDIDATE_CLASSIFICATION_SCAN_SECONDS = Math.max(15, Math.min(3600, Number(process.env.CANDIDATE_CLASSIFICATION_SCAN_SECONDS || 60)));
const CANDIDATE_CLASSIFICATION_BOOT_DELAY_MS = Math.max(1000, Math.min(120000, Number(process.env.CANDIDATE_CLASSIFICATION_BOOT_DELAY_MS || 12000)));
const CANDIDATE_CLASSIFICATION_BATCH_SIZE = Math.max(20, Math.min(200, Number(process.env.CANDIDATE_CLASSIFICATION_BATCH_SIZE || 100)));
const CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS = Math.max(1, Math.min(168, Number(process.env.CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS || 6)));
let candidateClassificationSchedulerStarted = false;
let candidateClassificationWorkerBusy = false;
let candidateClassificationQueueKickScheduled = false;
let candidateClassificationLastScanAt = null;
let candidateClassificationLastFullSweepAt = null;
const candidateClassificationPending = new Map();
const candidateClassificationRuntime = {
  running:false, lastTrigger:null, lastStartedAt:null, lastCompletedAt:null, lastDurationMs:0,
  lastScanned:0, lastClassified:0, lastSkipped:0, lastErrors:0, totalClassifiedSinceBoot:0, lastError:null,
};

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const FACTORY_SUPERADMIN_KEY = String(process.env.FACTORY_SUPERADMIN_KEY || '').trim();
const FACTORY_ADMIN_ALIAS = String(process.env.FACTORY_ADMIN_ALIAS || '').trim();
const FACTORY_ADMIN_PASSWORD = String(process.env.FACTORY_ADMIN_PASSWORD || '').trim();
// v7.9.11: FACTORY_SUPPORT_EMAIL sigue siendo la única identidad institucional de correo de Talento PyME.
// Se reutiliza la configuración ya existente en Render para soporte, consultas, recuperaciones y buzón administrativo.
const FACTORY_SUPPORT_EMAIL = String(process.env.FACTORY_SUPPORT_EMAIL || '').trim().toLowerCase();
const GMAIL_USER = FACTORY_SUPPORT_EMAIL;
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();
const GMAIL_CLIENT_ID = String(process.env.GMAIL_CLIENT_ID || '').trim();
const GMAIL_CLIENT_SECRET = String(process.env.GMAIL_CLIENT_SECRET || '').trim();
const GMAIL_REFRESH_TOKEN = String(process.env.GMAIL_REFRESH_TOKEN || '').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5-mini').trim() || 'gpt-5-mini';
const OPENAI_PRESENTATION_TIMEOUT_MS = Math.max(5000, Math.min(30000, Number(process.env.OPENAI_PRESENTATION_TIMEOUT_MS || 18000)));
const PRESENTATION_ANALYSIS_VERSION = 'AI_V710_EVIDENCE_ONLY';
const MAIL_FROM_NAME = String(process.env.MAIL_FROM_NAME || 'Talento PyME').trim();
const WEB_BASE_URL = String(process.env.WEB_BASE_URL || 'https://talento-pyme.onrender.com').replace(/\/$/, '').trim();
const PASSWORD_RESET_CODE_TTL_MINUTES = Math.max(5, Math.min(30, Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES || 10)));
const PASSWORD_RESET_MAX_ATTEMPTS = Math.max(3, Math.min(10, Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || 5)));
const PASSWORD_RESET_MAX_REQUESTS_15M = Math.max(1, Math.min(10, Number(process.env.PASSWORD_RESET_MAX_REQUESTS_15M || 3)));
const MAILBOX_FOLDER = String(process.env.MAILBOX_FOLDER || 'INBOX').trim() || 'INBOX';
// v7.9.11 · comunicaciones masivas protegidas por cola persistente.
// El límite queda deliberadamente por debajo del máximo teórico de Gmail para dejar margen
// a recuperaciones de contraseña, respuestas individuales, reportes y envíos manuales externos.
const COMMUNICATION_DAILY_LIMIT = Math.max(1, Math.min(450, Number(process.env.COMMUNICATION_DAILY_LIMIT || 450)));
const COMMUNICATION_SEND_INTERVAL_MS = Math.max(60000, Math.min(300000, Number(process.env.COMMUNICATION_SEND_INTERVAL_MS || 60000)));
const COMMUNICATION_WORKER_TICK_MS = Math.max(5000, Math.min(60000, Number(process.env.COMMUNICATION_WORKER_TICK_MS || 10000)));
const COMMUNICATION_RETRY_MINUTES = Math.max(10, Math.min(180, Number(process.env.COMMUNICATION_RETRY_MINUTES || 30)));
// v7.9.11 · bienvenida automática protegida. Se reserva capacidad fuera de las campañas masivas.
const WELCOME_DAILY_LIMIT = Math.max(1, Math.min(40, Number(process.env.WELCOME_DAILY_LIMIT || 40)));
const WELCOME_SEND_INTERVAL_MS = Math.max(120000, Math.min(600000, Number(process.env.WELCOME_SEND_INTERVAL_MS || 120000)));
const WELCOME_RETRY_MINUTES = Math.max(10, Math.min(180, Number(process.env.WELCOME_RETRY_MINUTES || 30)));
let communicationSchedulerStarted = false;
let communicationWorkerBusy = false;
let welcomeWorkerBusy = false;
let automaticMailSchedulerBusy = false;
const TRACEABILITY_REPORT_RECIPIENT = String(process.env.TRACEABILITY_REPORT_RECIPIENT || 'nestor.manucci@tecnolok.com.ar').trim().toLowerCase();
const VIRTUAL_ADMIN_USER_ID = '__factory_admin__';
const VIRTUAL_ADMIN_ROLE = 'SUPERADMIN';
const FACTORY_ADMIN_ALLOWED_COMPANIES = String(
  process.env.FACTORY_ADMIN_ALLOWED_COMPANIES ||
  process.env.FACTORY_ADMIN_ALLOWED_COMPANY ||
  'Mengabo SA,Mengabo Sociedad Anonima,Mengabo Sociedad Anónima,Mengavo SA'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);


function adminBackupModeLabel(mode){
  return ({ AUTOMATIC:'Automático', MANUAL:'Manual', PENDING:'Pendiente de configurar' }[String(mode || '').toUpperCase()] || 'Pendiente de configurar');
}

function adminBackupFrequencyLabel(freq){
  return ({ DAILY:'Diario', WEEKLY:'Semanal', MONTHLY:'Mensual' }[String(freq || '').toUpperCase()] || String(freq || 'Diario'));
}

function adminBackupProviderLabel(provider){
  return ({ EXTERNAL_PROVIDER:'Proveedor externo', PROVIDER:'Proveedor externo', INTERNAL:'Interno', MIXED:'Mixto' }[String(provider || '').toUpperCase()] || 'Proveedor externo');
}

function buildAdminBackupSummary(){
  const modeLabel = adminBackupModeLabel(ADMIN_BACKUP_MODE);
  const frequencyLabel = adminBackupFrequencyLabel(ADMIN_BACKUP_FREQUENCY).toLowerCase();
  const providerLabel = adminBackupProviderLabel(ADMIN_BACKUP_PROVIDER).toLowerCase();
  if (ADMIN_BACKUP_MODE === 'AUTOMATIC') {
    return `Automático ${frequencyLabel} · conserva últimos ${ADMIN_BACKUP_RETENTION_DAYS} día(s) · respaldo ${providerLabel}`;
  }
  if (ADMIN_BACKUP_MODE === 'MANUAL') {
    return `Manual · conserva últimos ${ADMIN_BACKUP_RETENTION_DAYS} día(s) · respaldo ${providerLabel}`;
  }
  return `${modeLabel} · conserva últimos ${ADMIN_BACKUP_RETENTION_DAYS} día(s) · respaldo ${providerLabel}`;
}

function backupDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}_${hh}${mm}${ss}`;
}

function safeIso(value){
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

function formatFileSizeMb(bytes = 0){
  const size = Number(bytes || 0);
  return Number((size / (1024 * 1024)).toFixed(2));
}

function guessProviderConsoleUrl(dbName = ''){
  const key = String(dbName || '').toLowerCase();
  if (DEFAULT_PROVIDER_CONSOLE_URL) return DEFAULT_PROVIDER_CONSOLE_URL;
  if (key.includes('neon')) return 'https://console.neon.tech';
  return '';
}

function detectDatabaseProvider(){
  try{
    const raw=String(process.env.DATABASE_URL || '');
    const host=raw ? new URL(raw).hostname.toLowerCase() : '';
    if(host.includes('neon.tech')) return { name:'Neon', engine:'PostgreSQL', consoleUrl:'https://console.neon.tech' };
    if(host.includes('supabase')) return { name:'Supabase', engine:'PostgreSQL', consoleUrl:'' };
    if(host.includes('render.com') || host.includes('render')) return { name:'Render PostgreSQL', engine:'PostgreSQL', consoleUrl:'' };
  }catch(_){ }
  return { name:'PostgreSQL', engine:'PostgreSQL', consoleUrl:'' };
}

function buildBackupGuardAssessment({ previousRecordCount = 0, currentRecordCount = 0, previousFileSizeBytes = 0, currentFileSizeBytes = 0, previousStats = {}, currentStats = {} } = {}){
  const ratioFloor = Number(ADMIN_BACKUP_MIN_SAFE_RATIO || 0.8);
  const issues = [];
  const details = [];
  const protectedDatasets = [
    ['users', 'usuarios'],
    ['candidates', 'candidatos'],
    ['companies', 'empresas'],
    ['billingOrders', 'facturación/tickets'],
  ];
  if (previousRecordCount > 0) {
    const recordRatio = currentRecordCount / previousRecordCount;
    details.push({ key:'recordCount', previous: previousRecordCount, current: currentRecordCount, ratio: Number(recordRatio.toFixed(4)) });
    if (recordRatio < ratioFloor) issues.push(`La cantidad total de registros cayó por debajo del ${(ratioFloor * 100).toFixed(0)}% del último backup confiable.`);
  }
  if (previousFileSizeBytes > 0) {
    const sizeRatio = currentFileSizeBytes / previousFileSizeBytes;
    details.push({ key:'fileSizeBytes', previous: previousFileSizeBytes, current: currentFileSizeBytes, ratio: Number(sizeRatio.toFixed(4)) });
    if (sizeRatio < ratioFloor) issues.push(`El peso estimado del backup cayó por debajo del ${(ratioFloor * 100).toFixed(0)}% del último backup confiable.`);
  }
  for (const [key, label] of protectedDatasets) {
    const prev = Number(previousStats?.[key] || 0);
    if (!prev) continue;
    const cur = Number(currentStats?.[key] || 0);
    const ratio = cur / prev;
    details.push({ key, previous: prev, current: cur, ratio: Number(ratio.toFixed(4)) });
    if (ratio < ratioFloor) issues.push(`La base protegida de ${label} quedó por debajo del ${(ratioFloor * 100).toFixed(0)}% respecto del último backup confiable.`);
  }
  return {
    ok: issues.length === 0,
    ratioFloor,
    issues,
    details,
  };
}

function parseJsonOrNull(value){
  if(!value) return null;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}

function sha256String(value = ''){
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function validateLogicalBackupPayload(payload){
  const datasets = payload && typeof payload === 'object' && payload.datasets && typeof payload.datasets === 'object' ? payload.datasets : null;
  const requiredKeys = ['users', 'candidateBolsa', 'companyProfiles', 'billingOrders', 'adminMonthlySnapshots'];
  const errors = [];
  if(!payload || typeof payload !== 'object') errors.push('Payload inválido');
  if(!payload?.meta || typeof payload.meta !== 'object') errors.push('Falta bloque meta');
  if(!payload?.stats || typeof payload.stats !== 'object') errors.push('Falta bloque stats');
  if(!datasets) errors.push('Falta bloque datasets');
  const datasetNames = datasets ? Object.keys(datasets) : [];
  requiredKeys.forEach((key) => {
    if(!datasets || !Array.isArray(datasets[key])) errors.push(`Dataset requerido ausente: ${key}`);
  });
  const datasetCount = datasetNames.length;
  const recordCount = datasetNames.reduce((acc, key) => acc + (Array.isArray(datasets?.[key]) ? datasets[key].length : 0), 0);
  return {
    ok: errors.length === 0,
    errors,
    datasetCount,
    datasetNames,
    recordCount,
    appVersion: payload?.meta?.appVersion || null,
    createdAt: payload?.meta?.createdAt || null,
  };
}

async function inspectBackupFile(filePath, expectedChecksum = null){
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const verification = validateLogicalBackupPayload(parsed);
  const checksumSha256 = sha256String(raw);
  return {
    ok: verification.ok && (!expectedChecksum || expectedChecksum === checksumSha256),
    checksumSha256,
    checksumMatches: expectedChecksum ? expectedChecksum === checksumSha256 : true,
    fileSizeBytes: Buffer.byteLength(raw, 'utf8'),
    fileSizeMb: formatFileSizeMb(Buffer.byteLength(raw, 'utf8')),
    payload: parsed,
    verification,
  };
}

async function ensureBackupsDir(){
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  return BACKUPS_DIR;
}

async function createBackupLog(data = {}){
  return prisma.adminBackupLog.create({ data }).catch(() => null);
}

async function updateBackupLog(id, data = {}){
  if(!id) return null;
  return prisma.adminBackupLog.update({ where: { id }, data }).catch(() => null);
}

async function getLatestCompletedBackupLog(){
  return prisma.adminBackupLog.findFirst({ where: { status: 'COMPLETED' }, orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }] }).catch(() => null);
}

async function getRecentBackupLogs(limit = 8){
  return prisma.adminBackupLog.findMany({ orderBy: [{ startedAt: 'desc' }], take: Math.max(1, Math.min(20, Number(limit || 8))) }).catch(() => []);
}

async function pruneOldBackupArtifacts(){
  const keepCount = Math.max(1, ADMIN_BACKUP_KEEP_FILES);
  const logs = await prisma.adminBackupLog.findMany({ where: { status: 'COMPLETED' }, orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }] }).catch(() => []);
  if(!Array.isArray(logs) || !logs.length) return;
  const keepIds = new Set(logs.slice(0, keepCount).map((item) => item.id));
  const threshold = Date.now() - (ADMIN_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  for (const log of logs.slice(keepCount)) {
    const completedAt = log.completedAt ? new Date(log.completedAt).getTime() : 0;
    if (completedAt && completedAt > threshold) continue;
    if (log.filePath) {
      await fs.unlink(log.filePath).catch(() => null);
    }
    if (!keepIds.has(log.id)) {
      await prisma.adminBackupLog.delete({ where: { id: log.id } }).catch(() => null);
    }
  }
}

async function collectLogicalBackupPayload(){
  const [
    users, profiles, skills, candidateBolsa, resumes, candidateClassifications, companyProfiles, jobCategories, jobs, applications, billingOrders, billingOrderItems, companyJobPublications, companyCandidateAccesses, billingCouponRedemptions, factoryPlanConfigs, factoryCoupons, companyFactoryGrants, paymentWebhookEvents, securityEvents, supportThreads, supportMessages, supportKnowledge, adminMonthlySnapshots, passwordResetChallenges
  ] = await Promise.all([
    prisma.user.findMany().catch(() => []),
    prisma.profile.findMany().catch(() => []),
    prisma.skill.findMany().catch(() => []),
    prisma.candidateBolsa.findMany().catch(() => []),
    prisma.resume.findMany().catch(() => []),
    prisma.candidateClassification.findMany().catch(() => []),
    prisma.companyProfile.findMany().catch(() => []),
    prisma.jobCategory.findMany().catch(() => []),
    prisma.job.findMany().catch(() => []),
    prisma.application.findMany().catch(() => []),
    prisma.billingOrder.findMany().catch(() => []),
    prisma.billingOrderItem.findMany().catch(() => []),
    prisma.companyJobPublication.findMany().catch(() => []),
    prisma.companyCandidateAccess.findMany().catch(() => []),
    prisma.billingCouponRedemption.findMany().catch(() => []),
    prisma.factoryPlanConfig.findMany().catch(() => []),
    prisma.factoryCoupon.findMany().catch(() => []),
    prisma.companyFactoryGrant.findMany().catch(() => []),
    prisma.paymentWebhookEvent.findMany().catch(() => []),
    prisma.securityEvent.findMany().catch(() => []),
    prisma.supportThread.findMany().catch(() => []),
    prisma.supportMessage.findMany().catch(() => []),
    prisma.supportKnowledge.findMany().catch(() => []),
    prisma.adminMonthlySnapshot.findMany().catch(() => []),
    prisma.passwordResetChallenge.findMany().catch(() => []),
  ]);

  const datasets = {
    users, profiles, skills, candidateBolsa, resumes, candidateClassifications, companyProfiles, jobCategories, jobs, applications, billingOrders, billingOrderItems, companyJobPublications, companyCandidateAccesses, billingCouponRedemptions, factoryPlanConfigs, factoryCoupons, companyFactoryGrants, paymentWebhookEvents, securityEvents, supportThreads, supportMessages, supportKnowledge, adminMonthlySnapshots, passwordResetChallenges,
  };
  const recordCount = Object.values(datasets).reduce((acc, rows) => acc + (Array.isArray(rows) ? rows.length : 0), 0);
  return {
    meta: {
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      backupKind: 'LOGICAL_JSON',
      containsSensitiveCredentials: true,
      notes: 'Resguardo lógico interno para continuidad operativa y recuperación administrativa. Mantener bajo acceso restringido.',
    },
    stats: {
      recordCount,
      users: users.length,
      candidates: users.filter((item) => String(item?.role || '').toUpperCase() === 'CANDIDATE').length,
      companies: companyProfiles.length,
      classifications: candidateClassifications.length,
      billingOrders: billingOrders.length,
      snapshots: adminMonthlySnapshots.length,
    },
    datasets,
  };
}

async function runLogicalBackup(triggerSource = 'MANUAL'){
  if(!ADMIN_LOCAL_BACKUP_ENABLED){
    return { ok: false, skipped: true, reason: 'LOCAL_BACKUP_DISABLED' };
  }
  if (backupRunPromise) return backupRunPromise;
  backupRunPromise = (async () => {
    await ensureBackupsDir();
    const startedAt = new Date();
    const backupKey = `logical_${backupDateKey(startedAt)}`;
    const fileName = `${backupKey}.json`;
    const filePath = path.join(BACKUPS_DIR, fileName);
    const log = await createBackupLog({
      backupKey,
      backupType: 'LOGICAL_JSON',
      storageDriver: 'LOCAL',
      status: 'RUNNING',
      triggerSource,
      fileName,
      filePath,
      retentionDays: ADMIN_BACKUP_RETENTION_DAYS,
      providerMode: ADMIN_BACKUP_PROVIDER,
      notes: 'Resguardo lógico generado desde superadministración.',
      startedAt,
    });
    try {
      const payload = await collectLogicalBackupPayload();
      const fileContent = JSON.stringify(payload, null, 2);
      const estimatedSizeBytes = Buffer.byteLength(fileContent, 'utf8');
      const latestTrusted = await getLatestCompletedBackupLog();
      const latestMeta = latestTrusted?.metadata || parseJsonOrNull(latestTrusted?.metadataJson) || {};
      const guard = buildBackupGuardAssessment({
        previousRecordCount: Number(latestTrusted?.recordCount || 0),
        currentRecordCount: Number(payload?.stats?.recordCount || 0),
        previousFileSizeBytes: Number(latestTrusted?.fileSizeBytes || 0),
        currentFileSizeBytes: estimatedSizeBytes,
        previousStats: latestMeta?.stats || {},
        currentStats: payload?.stats || {},
      });

      if (latestTrusted && guard.ok === false) {
        const blockedAt = new Date();
        await updateBackupLog(log?.id, {
          status: 'BLOCKED',
          failureReason: `Resguardo preventivo: el backup actual quedó por debajo del ${Math.round((guard.ratioFloor || 0) * 100)}% del último backup confiable.`,
          completedAt: blockedAt,
          fileSizeBytes: estimatedSizeBytes,
          recordCount: Number(payload?.stats?.recordCount || 0),
          metadataJson: JSON.stringify({
            stats: payload?.stats || {},
            meta: payload?.meta || {},
            guard,
            blockedAt: safeIso(blockedAt),
            trustedBackupKey: latestTrusted?.backupKey || null,
            trustedBackupAt: safeIso(latestTrusted?.completedAt || latestTrusted?.startedAt),
          }),
        });
        return {
          ok: false,
          blocked: true,
          reason: 'GUARD_BLOCKED',
          backupKey,
          trustedBackupKey: latestTrusted?.backupKey || null,
          guard,
        };
      }

      await fs.writeFile(filePath, fileContent, 'utf8');
      const stat = await fs.stat(filePath).catch(() => ({ size: 0 }));
      const completedAt = new Date();
      const result = {
        ok: true,
        backupKey,
        fileName,
        filePath,
        fileSizeBytes: Number(stat.size || 0),
        fileSizeMb: formatFileSizeMb(stat.size || 0),
        recordCount: Number(payload?.stats?.recordCount || 0),
        triggerSource,
        startedAt: safeIso(startedAt),
        completedAt: safeIso(completedAt),
      };
      const checksumSha256 = sha256String(fileContent);
      const verification = validateLogicalBackupPayload(payload);
      await updateBackupLog(log?.id, {
        status: 'COMPLETED',
        fileSizeBytes: result.fileSizeBytes,
        recordCount: result.recordCount,
        completedAt,
        metadataJson: JSON.stringify({
          stats: payload?.stats || {},
          meta: payload?.meta || {},
          checksumSha256,
          integrityOk: verification.ok,
          integrityErrors: verification.errors || [],
          datasetCount: verification.datasetCount || 0,
          datasetNames: verification.datasetNames || [],
          verifiedAt: safeIso(completedAt),
          guard: {
            ok: true,
            ratioFloor: Number(ADMIN_BACKUP_MIN_SAFE_RATIO || 0.8),
            issues: [],
            details: guard?.details || [],
          },
        }),
      });
      await pruneOldBackupArtifacts();
      return result;
    } catch (error) {
      console.error('runLogicalBackup', error);
      await fs.unlink(filePath).catch(() => null);
      await updateBackupLog(log?.id, {
        status: 'FAILED',
        failureReason: String(error?.message || 'No se pudo generar el backup lógico.'),
        completedAt: new Date(),
      });
      return { ok: false, error: String(error?.message || 'No se pudo generar el backup lógico.') };
    } finally {
      backupRunPromise = null;
    }
  })();
  return backupRunPromise;
}

async function ensureAutomaticLogicalBackup(triggerSource = 'AUTO_CHECK'){
  if(!ADMIN_LOCAL_BACKUP_ENABLED || ADMIN_BACKUP_MODE !== 'AUTOMATIC') return { ok: false, skipped: true, reason: 'AUTOMATIC_DISABLED' };
  const latest = await getLatestCompletedBackupLog();
  const lastTime = latest?.completedAt ? new Date(latest.completedAt).getTime() : 0;
  const due = !lastTime || (Date.now() - lastTime) >= (24 * 60 * 60 * 1000);
  if(!due) return { ok: true, skipped: true, latest };
  return runLogicalBackup(triggerSource);
}

async function readBackupOperationalSummary(){
  const recentLogs = await getRecentBackupLogs(8);
  const latestCompleted = (recentLogs || []).find((item) => item.status === 'COMPLETED') || null;
  const latestBlocked = (recentLogs || []).find((item) => item.status === 'BLOCKED') || null;
  const latestAny = recentLogs?.[0] || null;
  const lastCompletedAt = latestCompleted?.completedAt || latestCompleted?.startedAt || null;
  const lastCompletedTime = lastCompletedAt ? new Date(lastCompletedAt).getTime() : 0;
  const nextDueAt = lastCompletedTime ? new Date(lastCompletedTime + (24 * 60 * 60 * 1000)) : null;
  const isOverdue = ADMIN_BACKUP_MODE === 'AUTOMATIC' && (!!lastCompletedTime ? Date.now() > nextDueAt.getTime() : true);
  const trustedMeta = latestCompleted?.metadata || parseJsonOrNull(latestCompleted?.metadataJson) || {};
  const blockedMeta = latestBlocked?.metadata || parseJsonOrNull(latestBlocked?.metadataJson) || {};
  return {
    localBackupEnabled: ADMIN_LOCAL_BACKUP_ENABLED,
    backupStorage: 'LOCAL_JSON',
    backupScheduleCheckMinutes: ADMIN_BACKUP_CHECK_MINUTES,
    retainedFiles: ADMIN_BACKUP_KEEP_FILES,
    backupGuardEnabled: true,
    backupGuardMinRatio: Number(ADMIN_BACKUP_MIN_SAFE_RATIO || 0.8),
    lastBackupAt: safeIso(lastCompletedAt),
    lastBackupStatus: latestAny?.status || 'PENDING',
    lastBackupKey: latestCompleted?.backupKey || null,
    lastBackupFileName: latestCompleted?.fileName || null,
    lastBackupSizeBytes: Number(latestCompleted?.fileSizeBytes || 0),
    lastBackupSizeMb: formatFileSizeMb(latestCompleted?.fileSizeBytes || 0),
    lastBackupRecordCount: Number(latestCompleted?.recordCount || 0),
    lastBackupTrigger: latestCompleted?.triggerSource || null,
    lastBackupChecksum: trustedMeta?.checksumSha256 || null,
    lastBackupIntegrityOk: trustedMeta?.integrityOk !== false,
    lastBackupVerifiedAt: trustedMeta?.verifiedAt || null,
    lastBackupDatasetCount: Number(trustedMeta?.datasetCount || 0),
    nextBackupAt: safeIso(nextDueAt),
    backupOverdue: isOverdue,
    trustedBackupAt: safeIso(lastCompletedAt),
    trustedBackupKey: latestCompleted?.backupKey || null,
    trustedBackupFileName: latestCompleted?.fileName || null,
    trustedBackupStatus: latestCompleted ? 'COMPLETED' : 'PENDING',
    lastBlockedBackupAt: safeIso(latestBlocked?.completedAt || latestBlocked?.startedAt),
    lastBlockedBackupKey: latestBlocked?.backupKey || null,
    lastBlockedBackupReason: latestBlocked?.failureReason || null,
    lastBlockedBackupGuardIssues: Array.isArray(blockedMeta?.guard?.issues) ? blockedMeta.guard.issues : [],
    recentBackups: (recentLogs || []).map((log) => ({
      id: log.id,
      backupKey: log.backupKey,
      fileName: log.fileName,
      status: log.status,
      triggerSource: log.triggerSource,
      startedAt: safeIso(log.startedAt),
      completedAt: safeIso(log.completedAt),
      fileSizeBytes: Number(log.fileSizeBytes || 0),
      fileSizeMb: formatFileSizeMb(log.fileSizeBytes || 0),
      recordCount: Number(log.recordCount || 0),
      failureReason: log.failureReason || null,
      metadata: parseJsonOrNull(log.metadataJson),
    })),
  };
}

function startAutomaticBackupScheduler(){
  if (backupSchedulerStarted || !ADMIN_LOCAL_BACKUP_ENABLED || ADMIN_BACKUP_MODE !== 'AUTOMATIC') return;
  backupSchedulerStarted = true;
  setTimeout(() => { ensureAutomaticLogicalBackup('AUTO_BOOT').catch((err) => console.error('AUTO_BOOT backup', err)); }, 15000);
  const timer = setInterval(() => {
    ensureAutomaticLogicalBackup('AUTO_INTERVAL').catch((err) => console.error('AUTO_INTERVAL backup', err));
  }, ADMIN_BACKUP_CHECK_MINUTES * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

const PAYMENT_CONFIG = getPaymentConfigFromEnv(process.env);
const PAYMENT_PROVIDER_NAME = PAYMENT_CONFIG.provider;
const PAYMENT_CURRENCY = String(PAYMENT_CONFIG.currency || 'ars').toUpperCase();
const APP_BASE_URL = String(PAYMENT_CONFIG.appBaseUrl || '').trim();
const PAYMENT_SUCCESS_URL = String(PAYMENT_CONFIG.successUrl || '').trim();
const PAYMENT_CANCEL_URL = String(PAYMENT_CONFIG.cancelUrl || '').trim();
const PAYMENT_WEBHOOK_URL = String(PAYMENT_CONFIG.webhookUrl || '').trim();
let paymentProviderInstance = null;
function getPaymentProvider(){
  if (!paymentProviderInstance) paymentProviderInstance = createPaymentProvider(PAYMENT_CONFIG);
  return paymentProviderInstance;
}

const FACTORY_PLAN_DEFAULTS = [
  { code: 'P7', name: 'Publicación 7 días', days: 7, price: 0, publications: 7, searches: 7, active: true, highlight: '7 días · 7 publicaciones · 7 búsquedas.' },
  { code: 'P14', name: 'Publicación 14 días', days: 14, price: 95000, publications: 12, searches: 12, active: false, highlight: '14 días · 12 publicaciones · 12 búsquedas.' },
  { code: 'P30', name: 'Publicación 30 días', days: 30, price: 190000, publications: 20, searches: 20, active: false, highlight: '30 días · 20 publicaciones · 20 búsquedas.' },
  { code: 'P60', name: 'Publicación 60 días', days: 60, price: 340000, publications: 35, searches: 35, active: false, highlight: '60 días · 35 publicaciones · 35 búsquedas.' },
];

const LEGACY_FACTORY_COUPONS = {
  FACTORY100: 100,
  FACTORY50: 50,
  CAMARA100: 100,
  CAMARA50: 50,
};

// -----------------------------
// Helpers
// -----------------------------
function normalizeId(str = ""){
  return String(str||"").replace(/\D/g, "").trim();
}

function normalizeEmail(email = ""){
  return String(email||"").trim().toLowerCase();
}

function maskEmail(email = ""){
  const value = normalizeEmail(email);
  const parts = value.split("@");
  if(parts.length !== 2) return "correo registrado";
  const [local, domain] = parts;
  const domainParts = domain.split(".");
  const domainMain = domainParts.shift() || "";
  const suffix = domainParts.length ? "." + domainParts.join(".") : "";
  const localHead = local.slice(0, Math.min(2, local.length));
  const domainHead = domainMain.slice(0, 1);
  return `${localHead}${"x".repeat(Math.max(4, local.length - localHead.length))}@${domainHead}${"x".repeat(Math.max(4, domainMain.length - domainHead.length))}${suffix}`;
}

function gmailOauthConfigured(){
  return Boolean(GMAIL_USER && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN);
}
function gmailAppPasswordConfigured(){
  return Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
}
function gmailConfigured(){
  return gmailOauthConfigured() || gmailAppPasswordConfigured();
}

async function getGmailAuth(){
  if(gmailOauthConfigured()){
    const body = new URLSearchParams({
      client_id:GMAIL_CLIENT_ID,
      client_secret:GMAIL_CLIENT_SECRET,
      refresh_token:GMAIL_REFRESH_TOKEN,
      grant_type:'refresh_token',
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok || !data?.access_token) throw new Error('GMAIL_OAUTH_TOKEN_ERROR');
    return { mode:'oauth2', user:GMAIL_USER, accessToken:data.access_token };
  }
  if(gmailAppPasswordConfigured()) return { mode:'app_password', user:GMAIL_USER, pass:GMAIL_APP_PASSWORD };
  throw new Error('MAIL_NOT_CONFIGURED');
}

async function getSmtpTransport(){
  const auth = await getGmailAuth();
  return nodemailer.createTransport({
    host:"smtp.gmail.com", port:465, secure:true,
    connectionTimeout:10000,
    greetingTimeout:10000,
    socketTimeout:15000,
    auth: auth.mode === 'oauth2'
      ? { type:'OAuth2', user:auth.user, accessToken:auth.accessToken }
      : { user:auth.user, pass:auth.pass },
  });
}

function passwordCodeHash(challengeId, code){
  return crypto.createHmac("sha256", JWT_SECRET).update(`${challengeId}:${String(code || "")}`).digest("hex");
}

function safeEqualHex(a, b){
  try {
    const aa = Buffer.from(String(a || ""), "hex");
    const bb = Buffer.from(String(b || ""), "hex");
    return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}

function isLegacyCandidateIdentifier(value){
  return /^\d{11}$/.test(normalizeId(value));
}

function isCandidateDni(value){
  return /^\d{6,10}$/.test(normalizeId(value));
}

function isCompanyCuit(value){
  return /^\d{11}$/.test(normalizeId(value));
}

function isMailTransportNetworkError(err){
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '').toLowerCase();
  return ['ETIMEDOUT','ESOCKET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(code) || message.includes('timeout') || message.includes('network is unreachable');
}

function clampMultilineText(value = '', max = 4000){
  const normalized = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if(normalized.length <= max) return normalized;
  return normalized.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function escapeEmailHtml(value = ''){
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function supportEmailSubjectForRole(role){
  const normalized = String(role || '').toUpperCase();
  if(normalized === 'COMPANY') return 'Talento PyME · Información sobre tu cuenta empresa';
  return 'Talento PyME · Información sobre tu perfil profesional';
}

function resolveSupportThreadRecipient(thread){
  const role = String(thread?.role || '').toUpperCase();
  if(role === 'CANDIDATE') return normalizeEmail(thread?.user?.email || '');
  if(role === 'COMPANY') return normalizeEmail(thread?.company?.contactEmail || thread?.user?.email || '');
  return '';
}

async function sendSupportOperatorEmail({ thread, content, subject = '' }){
  if(!gmailConfigured()) {
    const err = new Error('MAIL_NOT_CONFIGURED');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const to = resolveSupportThreadRecipient(thread);
  if(!to){
    const err = new Error('RECIPIENT_NOT_AVAILABLE');
    err.code = 'RECIPIENT_NOT_AVAILABLE';
    throw err;
  }
  const cleanContent = clampMultilineText(content, 4000);
  if(!cleanContent){
    const err = new Error('EMPTY_SUPPORT_MESSAGE');
    err.code = 'EMPTY_SUPPORT_MESSAGE';
    throw err;
  }
  const safeSubject = clampText(String(subject || supportEmailSubjectForRole(thread?.role)).trim(), 180);
  const htmlBody = escapeEmailHtml(cleanContent).replace(/\n/g, '<br>');
  const portalLink = `${WEB_BASE_URL}/`;
  const transport = await getSmtpTransport();
  await transport.sendMail({
    from:`"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
    to,
    subject:safeSubject,
    text:`${cleanContent}\n\nPodés ingresar a Talento PyME desde: ${portalLink}\n\nEste mensaje fue enviado desde el área de Administración de Talento PyME.`,
    html:`<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:680px;margin:auto"><div style="padding:18px 20px;background:#0f2f5f;color:#fff;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:800">Talento PyME</div><div style="font-size:13px;opacity:.88">Conectando experiencia con producción.</div></div><div style="padding:22px 20px;border:1px solid #dbe4ef;border-top:0;border-radius:0 0 14px 14px"><div style="white-space:normal;font-size:15px">${htmlBody}</div><p style="margin-top:22px"><a href="${portalLink}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;padding:10px 15px;border-radius:9px;font-weight:700">Ingresar a Talento PyME</a></p><p style="color:#64748b;font-size:12px;margin-top:20px">Este mensaje fue enviado desde el área de Administración de Talento PyME.</p></div></div>`,
  });
  return { to, maskedEmail:maskEmail(to), subject:safeSubject };
}


function welcomeEmailCopy(role='CANDIDATE'){
  const isCompany=String(role || '').toUpperCase()==='COMPANY';
  if(isCompany){
    return {
      subject:'Bienvenido a Talento PyME · Tu empresa ya está registrada',
      text:`Estimada empresa de Talento PyME:\n\nTu registro se completó correctamente y tu cuenta ya está disponible.\n\nAl ingresar podés completar y mantener actualizado el perfil de la empresa, buscar talento, revisar candidatos, publicar búsquedas y utilizar las herramientas de seguimiento disponibles en el portal.\n\nPara comenzar:\n1. Ingresá a Talento PyME con los datos utilizados en el registro.\n2. Revisá y completá el perfil de la empresa.\n3. Utilizá Buscar Talento para explorar perfiles.\n4. Cuando corresponda, publicá una búsqueda laboral y administrá las postulaciones desde el portal.\n\nNo es necesario hacer todo en una sola vez: podés volver y actualizar la información cuando lo necesites.\n\nTalento PyME nunca solicita contraseñas ni códigos de seguridad por correo electrónico.`,
    };
  }
  return {
    subject:'Bienvenido a Talento PyME · Tu perfil ya está registrado',
    text:`Estimado candidato de Talento PyME:

¡Bienvenido! Tu registro se completó correctamente y tu perfil ya está disponible.

Para comenzar, ingresá con tu email y contraseña y abrí “Editar CV”. Podés completar la información paso a paso y guardar para continuar otro día.

En “Presentación Personal” podés hablar desde el micrófono del celular o escribir con tus propias palabras qué sabés hacer, cuál es tu experiencia, cuáles son tus fortalezas y qué tipo de trabajo buscás. Cuando termines, pulsá “Corrección IA profesional”: Talento PyME ordena y mejora la redacción y, si ya cargaste un CV, combina también esos antecedentes para preparar una presentación única. Todo lo generado queda bajo tu control y podés corregirlo, ampliarlo o borrarlo antes de guardar.

También podés cargar tu CV en PDF, DOCX o TXT, agregar una foto si lo deseás, consultar “Ver CV tipo” para conocer un ejemplo completo y descargar tu propio currículum desde “Descargar mi CV PDF”.

Recordá pulsar “Guardar cambios” para conservar cada actualización. Podés volver cuando quieras para seguir enriqueciendo tu perfil.

Talento PyME nunca solicita contraseñas ni códigos de seguridad por correo electrónico.`,
  };
}

async function sendWelcomeEmail(user){
  if(!gmailConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
  const role=String(user?.role || '').toUpperCase();
  const recipient=normalizeEmail(role==='COMPANY' ? (user?.company?.contactEmail || user?.email || '') : (user?.email || ''));
  if(!recipient) throw new Error('RECIPIENT_NOT_AVAILABLE');
  const suppressed=await prisma.emailSuppression.findUnique({where:{email:recipient}}).catch(()=>null);
  if(suppressed?.active){ const err=new Error('RECIPIENT_SUPPRESSED_INVALID_EMAIL'); err.code='RECIPIENT_SUPPRESSED'; throw err; }
  const copy=welcomeEmailCopy(role);
  const portalLink=`${WEB_BASE_URL}/`;
  const htmlBody=escapeEmailHtml(copy.text).replace(/\n/g,'<br>');
  const transport=await getSmtpTransport();
  await transport.sendMail({
    from:`"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
    to:recipient,
    subject:copy.subject,
    text:`${copy.text}\n\nIngresar a Talento PyME: ${portalLink}`,
    html:`<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.58;max-width:700px;margin:auto"><div style="padding:18px 20px;background:#0f2f5f;color:#fff;border-radius:14px 14px 0 0"><div style="font-size:21px;font-weight:800">Talento PyME</div><div style="font-size:13px;opacity:.9">Conectando experiencia con producción.</div></div><div style="padding:24px 22px;border:1px solid #dbe4ef;border-top:0;border-radius:0 0 14px 14px"><div style="font-size:15px">${htmlBody}</div><p style="margin-top:24px"><a href="${portalLink}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;padding:10px 15px;border-radius:9px;font-weight:700">Ingresar a Talento PyME</a></p><div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#64748b;font-size:12px">Este correo confirma tu registro en Talento PyME. No incluye solicitudes de contraseñas ni códigos de seguridad.</div></div></div>`,
  });
  return {recipient};
}

async function processWelcomeEmailQueueOnce(){
  if(welcomeWorkerBusy || !gmailConfigured()) return;
  welcomeWorkerBusy=true;
  try{
    const now=new Date();
    const since=new Date(now.getTime()-24*60*60*1000);
    const [sentCount,rolling,lastSentAt]=await Promise.all([
      prisma.user.count({ where:{ welcomeEmailSentAt:{ gte:since } } }),
      communicationRolling24hUsage(now),
      lastAutomaticMailSentAt(),
    ]);
    if(sentCount>=WELCOME_DAILY_LIMIT || rolling.count>=COMMUNICATION_DAILY_LIMIT) return;
    if(lastSentAt && now.getTime()-lastSentAt.getTime()<WELCOME_SEND_INTERVAL_MS) return;
    const retryBefore=new Date(now.getTime()-WELCOME_RETRY_MINUTES*60*1000);
    const user=await prisma.user.findFirst({
      where:{
        role:{ in:['CANDIDATE','COMPANY'] },
        welcomeEmailQueuedAt:{ not:null },
        welcomeEmailSentAt:null,
        OR:[{welcomeEmailLastAttemptAt:null},{welcomeEmailLastAttemptAt:{lte:retryBefore}}],
      },
      orderBy:{ welcomeEmailQueuedAt:'asc' },
      include:{ company:{select:{contactEmail:true}} },
    });
    if(!user) return;
    try{
      await sendWelcomeEmail(user);
      await prisma.user.update({ where:{id:user.id}, data:{ welcomeEmailSentAt:new Date(), welcomeEmailLastAttemptAt:new Date(), welcomeEmailLastError:null, welcomeEmailAttempts:{increment:1} } });
    }catch(err){
      await prisma.user.update({ where:{id:user.id}, data:{ welcomeEmailLastAttemptAt:new Date(), welcomeEmailLastError:String(err?.message || err || '').slice(0,500), welcomeEmailAttempts:{increment:1} } }).catch(()=>null);
    }
  }finally{ welcomeWorkerBusy=false; }
}


function communicationAudienceLabel(audience){
  return String(audience || '').toUpperCase() === 'COMPANY' ? 'empresas' : 'candidatos';
}

function communicationDefaultSubject(audience){
  return String(audience || '').toUpperCase() === 'COMPANY'
    ? 'Talento PyME · Información para empresas'
    : 'Talento PyME · Información para candidatos';
}

function buildBulkEmailUnsubscribeToken(userId, context={}){
  const payload={ sub:String(userId || ''), purpose:'BULK_EMAIL_UNSUBSCRIBE' };
  if(context.communicationId) payload.communicationId=String(context.communicationId);
  if(context.recipientId) payload.recipientId=String(context.recipientId);
  return jwt.sign(payload, JWT_SECRET);
}

function verifyBulkEmailUnsubscribeToken(token){
  const decoded = jwt.verify(String(token || ''), JWT_SECRET);
  if(decoded?.purpose !== 'BULK_EMAIL_UNSUBSCRIBE' || !decoded?.sub) throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  return decoded;
}

function communicationPreferenceSourceLabel(source){
  return ({
    SELF_SERVICE_LINK:'Enlace de baja del correo',
    EMAIL_PROVIDER_ONE_CLICK:'Baja desde el proveedor de correo',
    ADMIN_PANEL:'Administración',
    ADMIN_MAIL_REPLY:'Administración · solicitud recibida por correo',
    SYSTEM_MIGRATION:'Registro histórico migrado',
  })[String(source || '').toUpperCase()] || 'Origen no determinado';
}

function communicationPreferenceActionLabel(action){
  return ({
    OPT_OUT:'Baja de comunicaciones',
    OPT_IN:'Rehabilitación de comunicaciones',
    LEGACY_OPT_OUT_SNAPSHOT:'Baja histórica registrada',
  })[String(action || '').toUpperCase()] || 'Cambio de preferencia';
}

async function communicationPreferenceActorSnapshot(tx, actorUserId){
  const actorId=String(actorUserId || '').trim();
  if(!actorId) return { actorUserId:null, actorNameSnapshot:null, actorEmailSnapshot:null };
  if(actorId===VIRTUAL_ADMIN_USER_ID){
    return { actorUserId:null, actorNameSnapshot:'Administración Talento PyME', actorEmailSnapshot:FACTORY_SUPPORT_EMAIL || null };
  }
  const actor=await tx.user.findUnique({
    where:{id:actorId},
    select:{id:true,email:true,candidateProfile:{select:{fullName:true}},company:{select:{companyName:true}}},
  }).catch(()=>null);
  if(!actor) return { actorUserId:null, actorNameSnapshot:'Administración Talento PyME', actorEmailSnapshot:null };
  return {
    actorUserId:actor.id,
    actorNameSnapshot:clampText(actor.candidateProfile?.fullName || actor.company?.companyName || actor.email || 'Administración Talento PyME',180),
    actorEmailSnapshot:normalizeEmail(actor.email) || null,
  };
}

async function changeCommunicationPreference({
  userId, optOut, source, actorType, actorUserId=null, reasonCode, reasonText=null,
  communicationId=null, recipientId=null, metadata=null, legacyOptOutReason=null,
}){
  return prisma.$transaction(async (tx)=>{
    const user=await tx.user.findUnique({
      where:{id:String(userId || '')},
      select:{id:true,email:true,role:true,bulkEmailOptOutAt:true,company:{select:{contactEmail:true}}},
    });
    if(!user || !['CANDIDATE','COMPANY'].includes(String(user.role || '').toUpperCase())) throw new Error('INVALID_COMMUNICATION_PREFERENCE_USER');
    const previousOptOut=Boolean(user.bulkEmailOptOutAt);
    const nextOptOut=Boolean(optOut);
    if(previousOptOut===nextOptOut){
      return { changed:false, userId:user.id, role:user.role, optOut:previousOptOut, optOutAt:user.bulkEmailOptOutAt || null };
    }
    const now=new Date();
    const actor=actorType==='ADMIN' ? await communicationPreferenceActorSnapshot(tx,actorUserId) : {actorUserId:null,actorNameSnapshot:null,actorEmailSnapshot:null};
    const emailSnapshot=normalizeEmail(user.role==='COMPANY' ? (user.company?.contactEmail || user.email) : user.email) || normalizeEmail(user.email);
    await tx.communicationPreferenceEvent.create({
      data:{
        userId:user.id,
        emailSnapshot,
        action:nextOptOut ? 'OPT_OUT' : 'OPT_IN',
        previousOptOut,
        newOptOut:nextOptOut,
        source,
        actorType,
        actorUserId:actor.actorUserId,
        actorNameSnapshot:actor.actorNameSnapshot,
        actorEmailSnapshot:actor.actorEmailSnapshot,
        reasonCode:clampText(reasonCode || (nextOptOut ? 'OPT_OUT' : 'OPT_IN'),120),
        reasonText:clampMultilineText(reasonText || '',1000) || null,
        communicationId:communicationId || null,
        recipientId:recipientId || null,
        metadata:metadata && typeof metadata==='object' ? metadata : undefined,
        createdAt:now,
      },
    });
    await tx.user.update({
      where:{id:user.id},
      data:{
        bulkEmailOptOutAt:nextOptOut ? now : null,
        bulkEmailOptOutReason:nextOptOut ? clampText(legacyOptOutReason || source,120) : null,
      },
    });
    return { changed:true, userId:user.id, role:user.role, optOut:nextOptOut, optOutAt:nextOptOut ? now : null };
  });
}

function shapeCommunicationPreferenceEvent(event){
  if(!event) return null;
  const metadata=event.metadata && typeof event.metadata==='object' ? event.metadata : null;
  return {
    id:event.id,
    action:event.action,
    actionLabel:communicationPreferenceActionLabel(event.action),
    previousOptOut:event.previousOptOut,
    newOptOut:event.newOptOut,
    source:event.source,
    sourceLabel:communicationPreferenceSourceLabel(event.source),
    reasonCode:event.reasonCode,
    reasonText:event.reasonText || null,
    createdAt:event.createdAt,
    actorName:event.actorNameSnapshot || null,
    actorEmail:event.actorEmailSnapshot || null,
    historicalReconstruction:Boolean(metadata?.reconstructedFromCurrentState),
    legacyReason:metadata?.legacyBulkEmailOptOutReason || null,
    legacyReasonLabel:metadata?.legacyBulkEmailOptOutReason ? communicationPreferenceSourceLabel(metadata.legacyBulkEmailOptOutReason) : null,
  };
}

function bulkCommunicationFooterText(unsubscribeUrl){
  return `Si no querés recibir futuras comunicaciones informativas de Talento PyME, podés solicitar la baja desde este enlace: ${unsubscribeUrl}\n\nLa baja se aplica únicamente a comunicaciones generales. Los mensajes indispensables para la seguridad o funcionamiento de tu cuenta pueden seguir enviándose.`;
}

async function sendBulkCommunicationEmail({ to, subject, body, unsubscribePageUrl, unsubscribeApiUrl }){
  if(!gmailConfigured()) {
    const err = new Error('MAIL_NOT_CONFIGURED');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const recipient = normalizeEmail(to);
  const cleanBody = clampMultilineText(body, 10000);
  if(!recipient || !cleanBody) throw new Error('INVALID_BULK_EMAIL');
  const safeSubject = clampText(String(subject || '').trim(), 180) || 'Talento PyME · Comunicación';
  const bodyHtml = escapeEmailHtml(cleanBody).replace(/\n/g, '<br>');
  const safeUnsubscribeUrl = escapeEmailHtml(unsubscribePageUrl);
  const portalLink = `${WEB_BASE_URL}/`;
  const transport = await getSmtpTransport();
  await transport.sendMail({
    from:`"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
    to:recipient,
    subject:safeSubject,
    text:`${cleanBody}\n\n${bulkCommunicationFooterText(unsubscribePageUrl)}\n\nTalento PyME nunca solicita contraseñas ni códigos de seguridad mediante comunicaciones informativas.\nPortal: ${portalLink}`,
    headers:{ 'List-Unsubscribe':`<${unsubscribeApiUrl}>`, 'List-Unsubscribe-Post':'List-Unsubscribe=One-Click' },
    html:`<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.58;max-width:700px;margin:auto"><div style="padding:18px 20px;background:#0f2f5f;color:#fff;border-radius:14px 14px 0 0"><div style="font-size:21px;font-weight:800">Talento PyME</div><div style="font-size:13px;opacity:.9">Conectando experiencia con producción.</div></div><div style="padding:24px 22px;border:1px solid #dbe4ef;border-top:0;border-radius:0 0 14px 14px"><div style="font-size:15px">${bodyHtml}</div><p style="margin-top:24px"><a href="${portalLink}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;padding:10px 15px;border-radius:9px;font-weight:700">Ingresar a Talento PyME</a></p><div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:16px;color:#64748b;font-size:12px"><p style="margin:0 0 9px">Si no querés recibir futuras comunicaciones informativas de Talento PyME, <a href="${safeUnsubscribeUrl}" style="color:#475569">podés solicitar la baja desde aquí</a>.</p><p style="margin:0 0 9px">La baja sólo alcanza a comunicaciones generales; no afecta mensajes indispensables para la seguridad o funcionamiento de la cuenta.</p><p style="margin:0">Talento PyME nunca solicita contraseñas ni códigos de seguridad mediante comunicaciones informativas.</p></div></div></div>`,
  });
}

async function listBulkCommunicationRecipients(audience, {classKey='ALL'}={}){
  const normalized = String(audience || '').toUpperCase();
  const normalizedClassKey = String(classKey || 'ALL').trim().toUpperCase();
  if(!['CANDIDATE','COMPANY'].includes(normalized)) return { recipients:[], totalAccounts:0, optedOut:0, duplicates:0 };
  if(normalized==='CANDIDATE' && normalizedClassKey===SUPPORT_DETAIL_SEGMENT_KEY) return listSupportDetailRecipients();
  const users = normalized === 'COMPANY'
    ? await prisma.user.findMany({
        where:{ role:normalized },
        select:{ id:true, email:true, bulkEmailOptOutAt:true, company:{ select:{ contactEmail:true } } },
        orderBy:{ createdAt:'asc' },
      })
    : await prisma.user.findMany({
        where:{ role:normalized, ...(normalizedClassKey !== 'ALL' ? { candidateClassification:{ is:{ classKey:normalizedClassKey } } } : {}) },
        select:{ id:true, email:true, bulkEmailOptOutAt:true, candidateClassification:{ select:{ classKey:true, classLabel:true } } },
        orderBy:{ createdAt:'asc' },
      });
  const grouped = new Map();
  for(const user of users){
    const email = normalizeEmail(normalized === 'COMPANY' ? (user.company?.contactEmail || user.email) : user.email);
    if(!email) continue;
    const prev = grouped.get(email);
    const row = { userId:user.id, email, optedOut:Boolean(user.bulkEmailOptOutAt) };
    if(prev){
      grouped.set(email, { ...prev, optedOut:Boolean(prev.optedOut || row.optedOut) });
    } else grouped.set(email, row);
  }
  const all = [...grouped.values()];
  const activeSuppressions=all.length ? await prisma.emailSuppression.findMany({
    where:{active:true,email:{in:all.map((r)=>r.email)}},select:{email:true}
  }).catch(()=>[]) : [];
  const suppressedSet=new Set(activeSuppressions.map((r)=>normalizeEmail(r.email)));
  return {
    recipients:all.filter((r) => !r.optedOut && !suppressedSet.has(r.email)),
    totalAccounts:users.length,
    optedOut:all.filter((r) => r.optedOut).length,
    suppressed:all.filter((r)=>suppressedSet.has(r.email)).length,
    duplicates:Math.max(0, users.length - all.length),
    reachable:all.length,
  };
}


async function filterCommunicationRecipientsByHistory({ audience, subject, body, recipients=[], onlyNotPreviouslySent=true }){
  if(!onlyNotPreviouslySent || !recipients.length) return { recipients, skippedPreviouslySent:0, priorCampaignIds:[] };
  // v7.9.11: se compara la misma comunicación por audiencia + asunto + cuerpo. Esto también
  // reconoce campañas creadas en v7.9.11, que todavía no tenían una huella específica.
  const priorCampaigns=await prisma.adminCommunication.findMany({
    where:{ audience, subject, body },
    select:{ id:true },
  });
  if(!priorCampaigns.length) return { recipients, skippedPreviouslySent:0, priorCampaignIds:[] };
  const priorIds=priorCampaigns.map((row)=>row.id);
  const existing=await prisma.adminCommunicationRecipient.findMany({
    where:{ communicationId:{in:priorIds}, status:{in:['SENT','PENDING']} },
    select:{ userId:true },
    distinct:['userId'],
  });
  const blocked=new Set(existing.map((row)=>row.userId));
  const filtered=recipients.filter((row)=>!blocked.has(row.userId));
  return { recipients:filtered, skippedPreviouslySent:recipients.length-filtered.length, priorCampaignIds:priorIds };
}

const COMMUNICATION_NON_TERMINAL_STATUSES = ['QUEUED','SENDING','WAITING_DAILY_LIMIT','WAITING_RETRY'];

function buenosAiresDayKey(date = new Date()){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextBuenosAiresMidnightUtc(date = new Date()){
  const [y,m,d] = buenosAiresDayKey(date).split('-').map(Number);
  // Argentina utiliza UTC-3; 00:00 local equivale a 03:00 UTC.
  return new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 5));
}

async function communicationRolling24hUsage(now = new Date()){
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [campaignCount, welcomeCount, oldestCampaign, oldestWelcome] = await Promise.all([
    prisma.adminCommunicationRecipient.count({ where:{ status:'SENT', sentAt:{ gte:since } } }),
    prisma.user.count({ where:{ welcomeEmailSentAt:{ gte:since } } }),
    prisma.adminCommunicationRecipient.findFirst({ where:{ status:'SENT', sentAt:{ gte:since } }, orderBy:{ sentAt:'asc' }, select:{ sentAt:true } }),
    prisma.user.findFirst({ where:{ welcomeEmailSentAt:{ gte:since } }, orderBy:{ welcomeEmailSentAt:'asc' }, select:{ welcomeEmailSentAt:true } }),
  ]);
  const count=Number(campaignCount||0)+Number(welcomeCount||0);
  const oldestCandidates=[oldestCampaign?.sentAt,oldestWelcome?.welcomeEmailSentAt].filter(Boolean).map((d)=>new Date(d));
  const oldestSentAt=oldestCandidates.length ? new Date(Math.min(...oldestCandidates.map((d)=>d.getTime()))) : null;
  const nextAvailableAt = count >= COMMUNICATION_DAILY_LIMIT && oldestSentAt
    ? new Date(oldestSentAt.getTime() + 24 * 60 * 60 * 1000 + 60 * 1000)
    : null;
  return { count, campaignCount, welcomeCount, since, oldestSentAt, nextAvailableAt };
}

async function lastAutomaticMailSentAt(){
  const [campaign,welcome]=await Promise.all([
    prisma.adminCommunicationRecipient.findFirst({ where:{status:'SENT',sentAt:{not:null}},orderBy:{sentAt:'desc'},select:{sentAt:true} }),
    prisma.user.findFirst({ where:{welcomeEmailSentAt:{not:null}},orderBy:{welcomeEmailSentAt:'desc'},select:{welcomeEmailSentAt:true} }),
  ]);
  const dates=[campaign?.sentAt,welcome?.welcomeEmailSentAt].filter(Boolean).map((d)=>new Date(d));
  return dates.length ? new Date(Math.max(...dates.map((d)=>d.getTime()))) : null;
}

function isMailQuotaOrRateError(err){
  const code = String(err?.code || '').toUpperCase();
  const responseCode = Number(err?.responseCode || 0);
  const text = `${err?.message || ''} ${err?.response || ''}`.toLowerCase();
  return [421,429,450,451,452,454].includes(responseCode)
    || ['ERATELIMIT','EQUOTA'].includes(code)
    || /quota|rate limit|too many|daily limit|sending limit|temporarily deferred|try again later/.test(text);
}

function isTemporaryCommunicationMailError(err){
  return isMailTransportNetworkError(err) || isMailQuotaOrRateError(err);
}

async function communicationQueueSnapshot(){
  const todayKey = buenosAiresDayKey();
  const [rolling, sentToday, active, queueCount] = await Promise.all([
    communicationRolling24hUsage(),
    prisma.adminCommunicationRecipient.count({ where:{ status:'SENT', sentDayKey:todayKey } }),
    prisma.adminCommunication.findFirst({
      where:{ status:{ in:COMMUNICATION_NON_TERMINAL_STATUSES } },
      orderBy:{ createdAt:'asc' },
    }),
    prisma.adminCommunication.count({ where:{ status:{ in:COMMUNICATION_NON_TERMINAL_STATUSES } } }),
  ]);
  let activePending = 0;
  if(active){
    activePending = await prisma.adminCommunicationRecipient.count({
      where:{ communicationId:active.id, status:'PENDING' },
    });
  }
  return {
    dailyLimit:COMMUNICATION_DAILY_LIMIT,
    sentToday,
    sentRolling24h:rolling.count,
    remainingToday:Math.max(0, COMMUNICATION_DAILY_LIMIT - rolling.count),
    nextAvailableAt:rolling.nextAvailableAt,
    paceSeconds:Math.round(COMMUNICATION_SEND_INTERVAL_MS / 1000),
    queueCount,
    active:active ? {
      id:active.id,
      audience:active.audience,
      subject:active.subject,
      status:active.status,
      recipientCount:active.recipientCount,
      sentCount:active.sentCount,
      failedCount:active.failedCount,
      skippedOptOutCount:active.skippedOptOutCount,
      pendingCount:activePending,
      waitingUntil:active.waitingUntil,
      queuedAt:active.queuedAt,
      startedAt:active.startedAt,
    } : null,
  };
}

async function resolveCommunicationRecipient(recipientRow){
  const user = await prisma.user.findUnique({
    where:{ id:recipientRow.userId },
    select:{ id:true, email:true, role:true, bulkEmailOptOutAt:true, company:{ select:{ contactEmail:true } } },
  });
  if(!user || !['CANDIDATE','COMPANY'].includes(String(user.role || ''))) return { invalid:true, reason:'Cuenta no disponible.' };
  if(user.bulkEmailOptOutAt) return { optedOut:true };
  const email = normalizeEmail(user.role === 'COMPANY' ? (user.company?.contactEmail || user.email) : user.email);
  if(!email) return { invalid:true, reason:'Correo no disponible.' };
  const suppression=await prisma.emailSuppression.findUnique({where:{email}}).catch(()=>null);
  if(suppression?.active) return { invalid:true, reason:'Correo excluido por rebote definitivo confirmado.' };
  return { user, email };
}

async function finishCommunicationIfExhausted(communication){
  const pending = await prisma.adminCommunicationRecipient.count({ where:{ communicationId:communication.id, status:'PENDING' } });
  if(pending > 0) return false;
  await prisma.adminCommunication.update({
    where:{ id:communication.id },
    data:{ status:'COMPLETED', completedAt:new Date(), waitingUntil:null, lastError:null },
  });
  return true;
}

async function processCommunicationQueueOnce(){
  if(communicationWorkerBusy || !gmailConfigured()) return;
  communicationWorkerBusy = true;
  try {
    const communication = await prisma.adminCommunication.findFirst({
      where:{ status:{ in:COMMUNICATION_NON_TERMINAL_STATUSES } },
      orderBy:{ createdAt:'asc' },
    });
    if(!communication) return;

    // Una campaña por vez. Si la más antigua está esperando, ninguna posterior la adelanta.
    if(communication.status === 'WAITING_RETRY' && communication.waitingUntil && communication.waitingUntil > new Date()) return;
    if(communication.status === 'WAITING_DAILY_LIMIT' && communication.waitingUntil && communication.waitingUntil > new Date()) return;

    const rolling = await communicationRolling24hUsage();
    if(rolling.count >= COMMUNICATION_DAILY_LIMIT){
      const waitingUntil = rolling.nextAvailableAt || new Date(Date.now() + 60 * 60 * 1000);
      if(communication.status !== 'WAITING_DAILY_LIMIT' || !communication.waitingUntil || Math.abs(new Date(communication.waitingUntil).getTime() - waitingUntil.getTime()) > 60000){
        await prisma.adminCommunication.update({
          where:{ id:communication.id },
          data:{ status:'WAITING_DAILY_LIMIT', waitingUntil, lastError:null },
        });
      }
      return;
    }

    if(communication.status === 'WAITING_DAILY_LIMIT' || communication.status === 'WAITING_RETRY' || communication.status === 'QUEUED'){
      await prisma.adminCommunication.update({
        where:{ id:communication.id },
        data:{ status:'SENDING', startedAt:communication.startedAt || new Date(), waitingUntil:null, lastError:null },
      });
    }

    // Mantener separación temporal aun si Render reinicia el proceso.
    const lastSentAt = await lastAutomaticMailSentAt();
    if(lastSentAt && (Date.now() - lastSentAt.getTime()) < COMMUNICATION_SEND_INTERVAL_MS) return;

    const recipient = await prisma.adminCommunicationRecipient.findFirst({
      where:{ communicationId:communication.id, status:'PENDING' },
      orderBy:{ createdAt:'asc' },
    });
    if(!recipient){
      await finishCommunicationIfExhausted(communication);
      return;
    }

    const resolved = await resolveCommunicationRecipient(recipient);
    if(resolved.optedOut){
      await prisma.$transaction([
        prisma.adminCommunicationRecipient.update({ where:{ id:recipient.id }, data:{ status:'SKIPPED_OPTOUT', lastAttemptAt:new Date(), lastError:null } }),
        prisma.adminCommunication.update({ where:{ id:communication.id }, data:{ skippedOptOutCount:{ increment:1 } } }),
      ]);
      return;
    }
    if(resolved.invalid){
      await prisma.$transaction([
        prisma.adminCommunicationRecipient.update({ where:{ id:recipient.id }, data:{ status:'FAILED', attempts:{ increment:1 }, lastAttemptAt:new Date(), lastError:resolved.reason } }),
        prisma.adminCommunication.update({ where:{ id:communication.id }, data:{ failedCount:{ increment:1 } } }),
      ]);
      return;
    }

    const token = buildBulkEmailUnsubscribeToken(recipient.userId,{ communicationId:communication.id, recipientId:recipient.id });
    const apiBaseUrl = String(process.env.PUBLIC_API_URL || 'https://talento-pyme-api.onrender.com').replace(/\/$/, '');
    const unsubscribeApiUrl = `${apiBaseUrl}/communications/unsubscribe?token=${encodeURIComponent(token)}`;
    const unsubscribePageUrl = `${WEB_BASE_URL}/unsubscribe.html?token=${encodeURIComponent(token)}`;

    try {
      await sendBulkCommunicationEmail({
        to:resolved.email,
        subject:communication.subject,
        body:communication.body,
        unsubscribePageUrl,
        unsubscribeApiUrl,
      });
      const sentAt = new Date();
      await prisma.$transaction([
        prisma.adminCommunicationRecipient.update({
          where:{ id:recipient.id },
          data:{ status:'SENT', attempts:{ increment:1 }, sentAt, sentDayKey:buenosAiresDayKey(sentAt), lastAttemptAt:sentAt, lastError:null },
        }),
        prisma.adminCommunication.update({ where:{ id:communication.id }, data:{ sentCount:{ increment:1 }, lastError:null } }),
      ]);
    } catch (err) {
      const errText = clampText(String(err?.message || err?.code || 'Error de correo'), 500);
      if(isMailQuotaOrRateError(err)){
        await prisma.$transaction([
          prisma.adminCommunicationRecipient.update({ where:{ id:recipient.id }, data:{ attempts:{ increment:1 }, lastAttemptAt:new Date(), lastError:errText } }),
          prisma.adminCommunication.update({
            where:{ id:communication.id },
            data:{ status:'WAITING_DAILY_LIMIT', waitingUntil:new Date(Date.now() + 24 * 60 * 60 * 1000), lastError:'Gmail indicó límite o control temporal. El envío queda en pausa de seguridad y continuará automáticamente.' },
          }),
        ]);
        return;
      }
      if(isTemporaryCommunicationMailError(err)){
        const waitingUntil = new Date(Date.now() + COMMUNICATION_RETRY_MINUTES * 60 * 1000);
        await prisma.$transaction([
          prisma.adminCommunicationRecipient.update({ where:{ id:recipient.id }, data:{ attempts:{ increment:1 }, lastAttemptAt:new Date(), lastError:errText } }),
          prisma.adminCommunication.update({
            where:{ id:communication.id },
            data:{ status:'WAITING_RETRY', waitingUntil, lastError:'Problema temporal de correo. Talento PyME reintentará automáticamente.' },
          }),
        ]);
        return;
      }
      await prisma.$transaction([
        prisma.adminCommunicationRecipient.update({ where:{ id:recipient.id }, data:{ status:'FAILED', attempts:{ increment:1 }, lastAttemptAt:new Date(), lastError:errText } }),
        prisma.adminCommunication.update({ where:{ id:communication.id }, data:{ failedCount:{ increment:1 }, lastError:errText } }),
      ]);
    }
  } catch (err) {
    console.error('COMMUNICATION_QUEUE_WORKER', err?.code || err?.message || err);
  } finally {
    communicationWorkerBusy = false;
  }
}

async function processAutomaticMailQueuesOnce(){
  if(automaticMailSchedulerBusy) return;
  automaticMailSchedulerBusy=true;
  try{
    // La bienvenida es transaccional y tiene prioridad sobre una comunicación general pendiente.
    // Ambas colas comparten el mismo techo y el mismo espaciado para no producir picos SMTP.
    await processWelcomeEmailQueueOnce();
    await processCommunicationQueueOnce();
  }finally{ automaticMailSchedulerBusy=false; }
}

function startCommunicationQueueScheduler(){
  if(communicationSchedulerStarted) return;
  communicationSchedulerStarted = true;
  setTimeout(() => { processAutomaticMailQueuesOnce().catch(() => {}); }, 5000);
  const timer = setInterval(() => { processAutomaticMailQueuesOnce().catch(() => {}); }, COMMUNICATION_WORKER_TICK_MS);
  if(typeof timer.unref === 'function') timer.unref();
  console.log(`Cola de correos automática activa · máximo compartido ${COMMUNICATION_DAILY_LIMIT} en 24 h · campañas + bienvenidas · 1 envío escalonado`);
}


let supportMailboxSyncBusy=false;
let supportMailboxSchedulerStarted=false;
async function syncSupportMailboxOnce(){
  if(supportMailboxSyncBusy || !gmailConfigured()) return null;
  supportMailboxSyncBusy=true;
  try { return await syncSupportMailbox({limit:250}); }
  catch(err){ console.error('SUPPORT_MAILBOX_SYNC',err?.message||err); return null; }
  finally { supportMailboxSyncBusy=false; }
}
function startSupportMailboxScheduler(){
  if(supportMailboxSchedulerStarted) return;
  supportMailboxSchedulerStarted=true;
  setTimeout(()=>{syncSupportMailboxOnce().catch(()=>{});},15000);
  const timer=setInterval(()=>{syncSupportMailboxOnce().catch(()=>{});},30*60*1000);
  if(typeof timer.unref==='function') timer.unref();
  console.log('Bandeja unificada App + Email activa · sincronización cada 30 min');
}

async function sendPasswordRecoveryEmail({ to, code, challengeId, role }){
  const transport = await getSmtpTransport();
  const roleLabel = role === "COMPANY" ? "empresa" : "candidato";
  const link = `${WEB_BASE_URL}/forgot.html?challenge=${encodeURIComponent(challengeId)}&role=${encodeURIComponent(role)}`;
  await transport.sendMail({
    from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
    to,
    subject: "Talento PyME · Código para recuperar tu contraseña",
    text: `Recibimos una solicitud para recuperar el acceso de tu cuenta de ${roleLabel} en Talento PyME.\n\nCódigo de seguridad: ${code}\n\nEl código vence en ${PASSWORD_RESET_CODE_TTL_MINUTES} minutos.\nPodés continuar desde: ${link}\n\nSi no solicitaste este cambio, ignorá este correo.`,
    html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5"><h2 style="color:#1d4ed8">Talento PyME</h2><p>Recibimos una solicitud para recuperar el acceso de tu cuenta de <b>${roleLabel}</b>.</p><p>Tu código de seguridad es:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:14px 18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;display:inline-block">${code}</div><p>El código vence en <b>${PASSWORD_RESET_CODE_TTL_MINUTES} minutos</b>.</p><p><a href="${link}">Continuar recuperación</a></p><p style="color:#64748b;font-size:13px">Si no solicitaste este cambio, ignorá este correo. Tu contraseña actual seguirá funcionando.</p></div>`,
  });
}

async function createPasswordRecoveryChallenge({ user, role, requestedIdentifier, pendingDni = null }){
  if(!gmailConfigured()) {
    const err = new Error("El servicio de correo todavía no está configurado.");
    err.code = "MAIL_NOT_CONFIGURED";
    throw err;
  }
  const recentSince = new Date(Date.now() - 15 * 60 * 1000);
  const recentCount = await prisma.passwordResetChallenge.count({ where: { userId: user.id, createdAt: { gte: recentSince } } }).catch(() => 0);
  if(recentCount >= PASSWORD_RESET_MAX_REQUESTS_15M){
    const err = new Error("Se solicitaron varios códigos recientemente. Esperá unos minutos antes de intentar nuevamente.");
    err.code = "RATE_LIMIT";
    throw err;
  }
  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60 * 1000);
  await prisma.passwordResetChallenge.create({ data: {
    id: challengeId,
    userId: user.id,
    role,
    requestedIdentifier: requestedIdentifier || null,
    pendingDni: pendingDni || null,
    codeHash: passwordCodeHash(challengeId, code),
    maxAttempts: PASSWORD_RESET_MAX_ATTEMPTS,
    expiresAt,
  }});
  try {
    await sendPasswordRecoveryEmail({ to: user.email, code, challengeId, role });
    // Sólo el código más reciente queda activo. Esto evita que códigos anteriores
    // sigan siendo válidos después de solicitar uno nuevo.
    await prisma.passwordResetChallenge.updateMany({
      where: { userId: user.id, id: { not: challengeId }, consumedAt: null },
      data: { consumedAt: new Date() },
    }).catch(() => null);
    // Limpieza best-effort de desafíos antiguos para evitar crecimiento indefinido.
    await prisma.passwordResetChallenge.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }).catch(() => null);
  } catch (err) {
    await prisma.passwordResetChallenge.delete({ where: { id: challengeId } }).catch(() => null);
    throw err;
  }
  return { challengeId, maskedEmail: maskEmail(user.email), expiresAt };
}

async function withGmailInbox(fn){
  if(!gmailConfigured()) {
    const err = new Error("MAIL_NOT_CONFIGURED");
    err.code = "MAIL_NOT_CONFIGURED";
    throw err;
  }
  const auth = await getGmailAuth();
  const client = new ImapFlow({ host:"imap.gmail.com", port:993, secure:true, auth: auth.mode === "oauth2" ? { user:auth.user, accessToken:auth.accessToken } : { user:auth.user, pass:auth.pass }, logger:false });
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock(MAILBOX_FOLDER);
    return await fn(client);
  } finally {
    try { lock?.release(); } catch {}
    try { await client.logout(); } catch {}
  }
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
  const A = normalizeName(a).split(" ").sort().join(" ");
  const B = normalizeName(b).split(" ").sort().join(" ");
  const maxLen = Math.max(A.length, B.length);
  if(maxLen === 0) return 1;
  const dist = levenshtein(A, B);
  return 1 - (dist / maxLen);
}

function clampText(s = "", max = 12000){
  const str = String(s || "").replace(/\s+/g, " ").trim();
  if(str.length <= max) return str;
  const cut = str.slice(0, Math.max(0, max - 1));
  const last = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return (last > max * 0.65 ? cut.slice(0, last) : cut).trim() + "…";
}

function safeFileName(s = ""){
  return String(s || "file").replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "file";
}


function moneyInt(value){
  const n = Number(value || 0);
  if(!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function buildPaymentSuccessUrl(orderId = ''){
  const base = PAYMENT_SUCCESS_URL || (APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, '')}/factory.html?payment=success` : '');
  if(!base) return '';
  return `${base}${base.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(orderId)}`;
}

function buildPaymentCancelUrl(orderId = ''){
  const base = PAYMENT_CANCEL_URL || (APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, '')}/factory.html?payment=cancel` : '');
  if(!base) return '';
  return `${base}${base.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(orderId)}`;
}

function minimalActorMeta(user, company){
  return {
    actorUserId: user?.id || null,
    actorCompanyId: company?.id || null,
  };
}

async function recordSecurityEvent({ route = '', actorUserId = null, actorCompanyId = null, orderId = null, severity = 'INFO', eventType = 'SYSTEM_EVENT', message = '', metadata = null } = {}){
  const payload = {
    route,
    actorUserId,
    actorCompanyId,
    orderId,
    severity,
    eventType,
    message: clampText(message || '', 500),
    metadata: metadata || undefined,
  };
  const consoleMeta = { route, actorUserId, actorCompanyId, orderId, severity, eventType };
  console.log(`[SECURITY:${severity}] ${eventType} ${message}`, consoleMeta);
  await prisma.securityEvent.create({ data: payload }).catch(() => null);
}

function normalizeBillingForStorage(billing = {}, company = {}, user = null){
  return {
    billingName: String(billing.razonSocial || company.companyName || '').trim(),
    billingTaxId: normalizeId(billing.cuit || company.cuit || ''),
    billingTaxCondition: String(billing.condicionFiscal || '').trim() || null,
    billingProvince: String(billing.provincia || '').trim() || null,
    billingCity: String(billing.localidad || '').trim() || null,
    billingAddress: String(billing.calle || '').trim() || null,
    billingAddressNumber: String(billing.numero || '').trim() || null,
    billingFloor: String(billing.piso || '').trim() || null,
    billingDept: String(billing.depto || '').trim() || null,
    billingPostalCode: String(billing.codigoPostal || '').trim() || null,
    billingEmail: normalizeEmail(billing.email || company.contactEmail || user?.email || ''),
  };
}

async function createPendingPaymentOrder({ company, user, billing, quote }){
  return prisma.billingOrder.create({
    data: {
      companyId: company.id,
      status: 'PENDING_PAYMENT',
      companyNameSnapshot: company.companyName,
      cuitSnapshot: company.cuit,
      contactEmailSnapshot: company.contactEmail || user?.email || null,
      billingName: billing.billingName,
      billingTaxId: billing.billingTaxId,
      billingTaxCondition: billing.billingTaxCondition,
      billingProvince: billing.billingProvince,
      billingCity: billing.billingCity,
      billingAddress: billing.billingAddress,
      billingAddressNumber: billing.billingAddressNumber,
      billingFloor: billing.billingFloor,
      billingDept: billing.billingDept,
      billingPostalCode: billing.billingPostalCode,
      billingEmail: billing.billingEmail,
      couponCode: quote.coupon.valid ? quote.coupon.code : null,
      couponDiscountPct: quote.coupon.valid ? quote.coupon.discountPct : 0,
      subtotal: quote.subtotal,
      discountAmount: quote.discountAmount,
      vatAmount: quote.vatAmount,
      total: quote.total,
      totalDays: quote.totalDays,
      totalOpenings: quote.totalOpenings,
      paymentProvider: PAYMENT_PROVIDER_NAME,
      items: {
        create: quote.items.map((it)=> ({
          planCode: it.planCode,
          planName: it.planName,
          days: it.days,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          subtotal: it.subtotal,
          openingsIncluded: it.openingsIncluded,
          publicationsIncluded: it.publicationsIncluded,
        }))
      }
    },
    include: { company: true, items: true }
  });
}

async function applyCouponRedemptionIfNeeded(order){
  if(!order?.couponCode || !order?.companyId) return;
  const code = String(order.couponCode || '').trim().toUpperCase();
  if(!code) return;
  await prisma.billingCouponRedemption.upsert({
    where: { companyId_code: { companyId: order.companyId, code } },
    update: { discountPct: Number(order.couponDiscountPct || 0) },
    create: { companyId: order.companyId, code, discountPct: Number(order.couponDiscountPct || 0) }
  }).catch(() => null);
  await prisma.factoryCoupon.update({ where: { code }, data: { isActive: false } }).catch(() => null);
}

async function updateOrderStatusFromProvider(order, event){
  const nextStatus = event.outcome === 'PAID'
    ? 'PAID'
    : event.outcome === 'FAILED'
      ? 'FAILED'
      : event.outcome === 'EXPIRED'
        ? 'EXPIRED'
        : event.outcome === 'CANCELLED'
          ? 'CANCELLED'
          : 'PENDING_PAYMENT';

  const updateData = {
    status: nextStatus,
    paymentProvider: event.provider || order.paymentProvider || PAYMENT_PROVIDER_NAME,
    paymentSessionRef: event.paymentSessionRef || order.paymentSessionRef || null,
    paymentProviderRef: event.paymentProviderRef || order.paymentProviderRef || null,
    paymentFailureReason: nextStatus === 'PAID' ? null : (event.failureReason || order.paymentFailureReason || null),
    paymentReceiptUrl: event.receiptUrl || order.paymentReceiptUrl || null,
    paymentApprovedAt: nextStatus === 'PAID' ? (order.paymentApprovedAt || new Date()) : order.paymentApprovedAt,
    cardBrand: event.cardBrand || order.cardBrand || null,
    cardLast4: event.cardLast4 || order.cardLast4 || null,
  };
  const updated = await prisma.billingOrder.update({ where: { id: order.id }, data: updateData, include: { company: true, items: true } });
  if(nextStatus === 'PAID') await applyCouponRedemptionIfNeeded(updated);
  return updated;
}

async function recordPaymentWebhookEvent(event, signatureValid, rawBody, orderId = null){
  return prisma.paymentWebhookEvent.create({
    data: {
      provider: event.provider || PAYMENT_PROVIDER_NAME,
      providerEventId: event.providerEventId,
      orderId,
      eventType: event.eventType || 'unknown',
      outcome: event.outcome || null,
      signatureValid,
      processed: false,
      payloadHash: sha256Hex(rawBody || ''),
    }
  });
}

async function ensureFactoryPlanSeed(){
  const count = await prisma.factoryPlanConfig.count().catch(() => 0);
  if(count > 0) return;
  await prisma.$transaction(FACTORY_PLAN_DEFAULTS.map((plan, idx) => prisma.factoryPlanConfig.upsert({
    where: { code: plan.code },
    update: {
      name: plan.name,
      days: plan.days,
      price: plan.price,
      publicationsLimit: plan.publications,
      searchesLimit: plan.searches,
      sortOrder: idx,
      active: plan.active !== false,
    },
    create: {
      code: plan.code,
      name: plan.name,
      days: plan.days,
      price: plan.price,
      publicationsLimit: plan.publications,
      searchesLimit: plan.searches,
      sortOrder: idx,
      active: plan.active !== false,
    }
  }))).catch(() => null);
}

async function getFactoryPlans(includeInactive = false){
  await ensureFactoryPlanSeed();
  const rows = await prisma.factoryPlanConfig.findMany({ orderBy: [{ sortOrder: 'asc' }, { days: 'asc' }] }).catch(() => []);
  const source = rows.length ? rows : FACTORY_PLAN_DEFAULTS.map((plan, idx)=> ({
    code: plan.code,
    name: plan.name,
    days: plan.days,
    price: plan.price,
    publicationsLimit: plan.publications,
    searchesLimit: plan.searches,
    sortOrder: idx,
    active: plan.active !== false,
  }));
  const filtered = includeInactive ? source : source.filter((row)=> row.active !== false);
  return filtered.map((row) => ({
    code: row.code,
    name: row.name,
    days: row.days,
    price: row.price,
    publications: row.publicationsLimit || row.publications || 0,
    searches: row.searchesLimit || row.searches || 0,
    active: row.active !== false,
    highlight: `${row.days} días · ${(row.publicationsLimit || row.publications || 0)} publicaciones · ${(row.searchesLimit || row.searches || 0)} búsquedas.`,
  }));
}

async function planByCode(code){
  const plans = await getFactoryPlans(false);
  return plans.find((it)=> it.code === String(code || '').trim().toUpperCase()) || null;
}

function buildInternalTicketNumber(orderId){
  return `TCK-${String(orderId || '').slice(-8).toUpperCase()}`;
}

function companyVisibleOrder(order, now = new Date()){
  if(!order) return false;
  if(String(order.status || '').toUpperCase() === 'PENDING_PAYMENT') return (new Date(now).getTime() - new Date(order.createdAt || now).getTime()) < FACTORY_PENDING_TTL_MS;
  if(String(order.status || '').toUpperCase() !== 'PAID') return false;
  return (order.items || []).some((item) => orderItemExpiresAt(order, item) > now);
}

async function expireStalePendingOrders(companyId = null){
  const cutoff = new Date(Date.now() - FACTORY_PENDING_TTL_MS);
  const staleOrders = await prisma.billingOrder.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      createdAt: { lt: cutoff },
      ...(companyId ? { companyId } : {}),
    },
    include: { items: true },
  }).catch(() => []);
  if(!staleOrders.length) return [];
  for(const order of staleOrders){
    await prisma.billingOrder.update({
      where: { id: order.id },
      data: {
        status: 'EXPIRED',
        paymentFailureReason: order.paymentFailureReason || 'El pedido venció por falta de confirmación dentro de las 24 horas.',
      }
    }).catch(() => null);
  }
  return staleOrders;
}

async function findBlockingFreeTicket(companyId, excludeOrderId = null){
  const now = new Date();
  const orders = await prisma.billingOrder.findMany({
    where: {
      companyId,
      status: 'PAID',
      paymentProvider: 'INTERNAL_TICKET',
      ...(excludeOrderId ? { NOT: { id: excludeOrderId } } : {}),
      items: { some: {} },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  if(!orders.length) return null;

  const [searchAccesses, jobPublications] = await Promise.all([
    prisma.companyCandidateAccess.findMany({ where: { companyId, expiresAt: { gt: now } }, select: { orderItemId: true } }).catch(() => []),
    prisma.companyJobPublication.findMany({ where: { companyId, expiresAt: { gt: now } }, select: { orderItemId: true } }).catch(() => []),
  ]);

  const usedSearches = {};
  for(const row of searchAccesses) usedSearches[row.orderItemId] = (usedSearches[row.orderItemId] || 0) + 1;
  const usedPublications = {};
  for(const row of jobPublications) usedPublications[row.orderItemId] = (usedPublications[row.orderItemId] || 0) + 1;

  for(const order of orders){
    for(const item of order.items || []){
      const expiresAt = orderItemExpiresAt(order, item);
      if(expiresAt <= now) continue;
      const remainingSearches = Math.max(0, Number(item.openingsIncluded || 0) - Number(usedSearches[item.id] || 0));
      const remainingPublications = Math.max(0, Number(item.publicationsIncluded || 0) - Number(usedPublications[item.id] || 0));
      const bundleStillActive = remainingSearches > 0 && remainingPublications > 0;
      if(order.status === 'PENDING_PAYMENT' || bundleStillActive){
        return {
          order,
          item,
          expiresAt,
          remainingSearches: order.status === 'PENDING_PAYMENT' ? Number(item.openingsIncluded || 0) : remainingSearches,
          remainingPublications: order.status === 'PENDING_PAYMENT' ? Number(item.publicationsIncluded || 0) : remainingPublications,
          ticketNo: buildInternalTicketNumber(order.id),
          pendingValidation: order.status === 'PENDING_PAYMENT',
        };
      }
    }
  }
  return null;
}

async function issueZeroAmountTicket(order, actor = {}){
  const paidAt = new Date();
  const updated = await prisma.billingOrder.update({
    where: { id: order.id },
    data: {
      status: 'PAID',
      paymentProvider: 'INTERNAL_TICKET',
      paymentProviderRef: buildInternalTicketNumber(order.id),
      paymentApprovedAt: paidAt,
      paymentFailureReason: null,
      paymentReceiptUrl: null,
    },
    include: { company: true, items: true }
  });
  await applyCouponRedemptionIfNeeded(updated);
  await recordSecurityEvent({
    route: '/factory/checkout',
    ...actor,
    orderId: updated.id,
    severity: 'INFO',
    eventType: 'ZERO_TICKET_ISSUED',
    message: 'Se emitió un ticket interno sin cargo para habilitar capacidad de prueba.',
    metadata: { total: updated.total || 0, documentNo: buildInternalTicketNumber(updated.id) },
  });
  return updated;
}

function companyCodeFrom(company){
  const raw = normalizeId(company?.cuit || '');
  if(raw) return raw.slice(-8);
  return String(company?.id || '').slice(-8).toUpperCase() || '00000000';
}

const FACTORY_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function orderItemExpiresAt(order, item){
  const base = new Date(order?.createdAt || Date.now());
  const days = Number(item?.days || 0);
  base.setDate(base.getDate() + Math.max(0, days));
  return base;
}

async function getCompanyOperationUsage(companyId){
  const now = new Date();
  const activeOrders = await prisma.billingOrder.findMany({
    where: {
      companyId,
      status: 'PAID',
      items: { some: {} }
    },
    include: { items: true },
    orderBy: { createdAt: 'asc' }
  }).catch(() => []);

  const activeGrants = await prisma.companyFactoryGrant.findMany({
    where: { companyId, fullAccessUntil: { gt: now } },
    orderBy: { fullAccessUntil: 'desc' }
  }).catch(() => []);

  const activeItems = [];
  let latestPrivilegeUntil = null;
  for(const order of activeOrders){
    for(const item of order.items || []){
      const expiresAt = orderItemExpiresAt(order, item);
      if(expiresAt <= now) continue;
      latestPrivilegeUntil = !latestPrivilegeUntil || expiresAt > latestPrivilegeUntil ? expiresAt : latestPrivilegeUntil;
      const searchesIncluded = Number(item.openingsIncluded || 0);
      const publicationsIncluded = Number(item.publicationsIncluded || 0);
      if(searchesIncluded <= 0 && publicationsIncluded <= 0) continue;
      activeItems.push({
        orderId: order.id,
        orderItemId: item.id,
        createdAt: order.createdAt,
        expiresAt,
        planCode: item.planCode,
        planName: item.planName,
        days: item.days,
        searchesIncluded,
        publicationsIncluded,
      });
    }
  }

  const searchAccesses = await prisma.companyCandidateAccess.findMany({
    where: { companyId, expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' }
  }).catch(() => []);

  const jobPublications = await prisma.companyJobPublication.findMany({
    where: { companyId, expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' }
  }).catch(() => []);

  const usedSearchesByItem = {};
  for(const row of searchAccesses) usedSearchesByItem[row.orderItemId] = (usedSearchesByItem[row.orderItemId] || 0) + 1;
  const usedPublicationsByItem = {};
  for(const row of jobPublications) usedPublicationsByItem[row.orderItemId] = (usedPublicationsByItem[row.orderItemId] || 0) + 1;

  const activeItemsDetailed = activeItems.map((item) => {
    const remainingSearches = Math.max(0, Number(item.searchesIncluded || 0) - Number(usedSearchesByItem[item.orderItemId] || 0));
    const remainingPublications = Math.max(0, Number(item.publicationsIncluded || 0) - Number(usedPublicationsByItem[item.orderItemId] || 0));
    const daysRemaining = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    const bundleReady = daysRemaining > 0 && remainingSearches > 0 && remainingPublications > 0;
    const queueReason = daysRemaining <= 0
      ? 'Vencido'
      : remainingSearches <= 0
        ? 'Búsquedas agotadas'
        : remainingPublications <= 0
          ? 'Publicaciones agotadas'
          : 'Disponible';
    return {
      ...item,
      usedSearches: Number(usedSearchesByItem[item.orderItemId] || 0),
      usedPublications: Number(usedPublicationsByItem[item.orderItemId] || 0),
      remainingSearches,
      remainingPublications,
      daysRemaining,
      bundleReady,
      queueReason,
    };
  }).sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime() || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const fullAccess = activeGrants.length > 0;
  const fullAccessUntil = activeGrants.reduce((acc, row)=> (!acc || row.fullAccessUntil > acc) ? row.fullAccessUntil : acc, latestPrivilegeUntil);
  const activeQueue = activeItemsDetailed.filter((item) => item.bundleReady);
  const deferredQueue = activeItemsDetailed.filter((item) => !item.bundleReady);
  const queueSearchTotal = activeQueue.reduce((acc, item) => acc + Number(item.searchesIncluded || 0), 0);
  const queueSearchRemaining = activeQueue.reduce((acc, item) => acc + Number(item.remainingSearches || 0), 0);
  const queuePublicationTotal = activeQueue.reduce((acc, item) => acc + Number(item.publicationsIncluded || 0), 0);
  const queuePublicationRemaining = activeQueue.reduce((acc, item) => acc + Number(item.remainingPublications || 0), 0);

  const remainingSearches = fullAccess ? 999999 : queueSearchRemaining;
  const remainingPublications = fullAccess ? 999999 : queuePublicationRemaining;
  const totalSearches = fullAccess ? activeItemsDetailed.reduce((acc, item) => acc + Number(item.searchesIncluded || 0), 0) : queueSearchTotal;
  const totalPublications = fullAccess ? activeItemsDetailed.reduce((acc, item) => acc + Number(item.publicationsIncluded || 0), 0) : queuePublicationTotal;
  const currentPlan = fullAccess
    ? {
        planCode: 'FULL_ACCESS',
        planName: 'Acceso total especial',
        expiresAt: fullAccessUntil || null,
        daysRemaining: fullAccessUntil ? Math.max(0, Math.ceil((new Date(fullAccessUntil).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : null,
        remainingSearches,
        remainingPublications,
        searchesIncluded: totalSearches,
        publicationsIncluded: totalPublications,
      }
    : (activeQueue[0] || null);

  return {
    now,
    totalSearches,
    usedSearches: searchAccesses.length,
    remainingSearches,
    totalOpenings: totalSearches,
    usedOpenings: searchAccesses.length,
    remainingOpenings: remainingSearches,
    totalPublications,
    usedPublications: jobPublications.length,
    remainingPublications,
    activeItems,
    activeItemsDetailed,
    activeQueue,
    deferredQueue,
    activeAccesses: searchAccesses,
    jobPublications,
    fullAccess,
    fullAccessUntil,
    activeGrants,
    currentPlan,
  };
}

async function consumeCompanyQuota(companyId, kind){
  const usage = await getCompanyOperationUsage(companyId);
  if(usage.fullAccess){
    return { ok: true, consumed: false, usage, fullAccess: true, expiresAt: usage.fullAccessUntil || null };
  }
  const remainingField = kind === 'publication' ? 'remainingPublications' : 'remainingSearches';
  if((usage[remainingField] || 0) <= 0){
    return {
      ok: false,
      consumed: false,
      usage,
      error: kind === 'publication'
        ? 'No tenés publicaciones disponibles en tu plan actual. Contratá más capacidad desde Factory para seguir publicando avisos.'
        : 'No tenés búsquedas disponibles en tu plan actual. Contratá más capacidad desde Factory para seguir abriendo fichas completas.'
    };
  }
  const target = Array.isArray(usage.activeQueue) ? usage.activeQueue[0] : null;
  if(!target){
    return { ok: false, consumed: false, usage, error: 'No se encontró una capacidad activa para continuar. Revisá Factory y actualizá tu plan.' };
  }
  if(kind === 'publication' && Number(target.remainingPublications || 0) <= 0){
    return { ok: false, consumed: false, usage, error: 'La capacidad activa actual ya agotó sus publicaciones. Esperá el siguiente bloque vigente o contratá más capacidad.' };
  }
  if(kind !== 'publication' && Number(target.remainingSearches || 0) <= 0){
    return { ok: false, consumed: false, usage, error: 'La capacidad activa actual ya agotó sus búsquedas. Esperá el siguiente bloque vigente o contratá más capacidad.' };
  }
  return { ok: true, consumed: true, usage, sourceItem: target, expiresAt: target.expiresAt, fullAccess: false };
}

async function ensureCompanyCandidateAccess(companyId, candidateId){
  const now = new Date();
  const existing = await prisma.companyCandidateAccess.findFirst({
    where: { companyId, candidateId, expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' }
  }).catch(() => null);

  const usage = await getCompanyOperationUsage(companyId);
  if(existing || usage.fullAccess){
    return { ok: true, consumed: false, access: existing, usage };
  }

  const quota = await consumeCompanyQuota(companyId, 'search');
  if(!quota.ok){
    return { ok: false, consumed: false, error: quota.error, usage: quota.usage || usage };
  }

  const access = await prisma.companyCandidateAccess.create({
    data: {
      companyId,
      candidateId,
      orderItemId: quota.sourceItem.orderItemId,
      expiresAt: quota.expiresAt,
    }
  });
  const refreshedUsage = await getCompanyOperationUsage(companyId);
  return { ok: true, consumed: true, access, usage: refreshedUsage, sourceItem: quota.sourceItem };
}

async function ensureCompanyPublicationAccess(companyId, jobId){
  const existing = await prisma.companyJobPublication.findUnique({ where: { jobId } }).catch(() => null);
  if(existing) return { ok: true, consumed: false, publication: existing, usage: await getCompanyOperationUsage(companyId) };
  const quota = await consumeCompanyQuota(companyId, 'publication');
  if(!quota.ok) return { ok: false, consumed: false, usage: quota.usage, error: quota.error };
  if(quota.fullAccess){
    return { ok: true, consumed: false, publication: null, usage: quota.usage };
  }
  const publication = await prisma.companyJobPublication.create({
    data: {
      companyId,
      jobId,
      orderItemId: quota.sourceItem.orderItemId,
      expiresAt: quota.expiresAt,
    }
  });
  return { ok: true, consumed: true, publication, usage: await getCompanyOperationUsage(companyId), sourceItem: quota.sourceItem };
}

function factoryAdminCompanyMatches(company){
  if(!FACTORY_ADMIN_ALLOWED_COMPANIES.length) return true;
  const current = normalizeName(company?.companyName || '');
  if(!current) return false;
  return FACTORY_ADMIN_ALLOWED_COMPANIES.some((name) => normalizeName(name) === current);
}

function factoryAdminVisibilityMessage(company){
  if(factoryAdminCompanyMatches(company)) return '';
  const allowed = FACTORY_ADMIN_ALLOWED_COMPANIES[0] || 'la empresa habilitada';
  return `Factory Admin solo está disponible para la empresa virtual habilitada (${allowed}).`;
}

function isFactoryAdminCredentialsAuthorized(req){
  if(['SUPERADMIN', 'ADMIN'].includes(String(req.user?.role || '').toUpperCase())) return true;
  const sentLegacy = String(req.headers['x-factory-admin-key'] || '').trim();
  if(FACTORY_SUPERADMIN_KEY && sentLegacy && sentLegacy === FACTORY_SUPERADMIN_KEY) return true;
  const sentAlias = String(req.headers['x-factory-admin-alias'] || '').trim();
  const sentPassword = String(req.headers['x-factory-admin-password'] || '').trim();
  return !!FACTORY_ADMIN_ALIAS && !!FACTORY_ADMIN_PASSWORD && sentAlias === FACTORY_ADMIN_ALIAS && sentPassword === FACTORY_ADMIN_PASSWORD;
}

async function requireFactoryAdmin(req, res, next){
  const role = String(req.user?.role || '').toUpperCase();
  if(['SUPERADMIN','ADMIN'].includes(role)) return next();
  const { company } = await getCompanyContextByUserId(req.user.id);
  if(!factoryAdminCompanyMatches(company)) return res.status(403).json({ error: factoryAdminVisibilityMessage(company) || 'Factory Admin no está habilitado para esta empresa.' });
  if(isFactoryAdminCredentialsAuthorized(req)) return next();
  return res.status(403).json({ error: 'Acceso Factory Admin no habilitado.' });
}

async function getCompanyContextByUserId(userId){
  if (userId === VIRTUAL_ADMIN_USER_ID) {
    return { company: { id: 'virtual-admin-company', companyName: 'Talento PyME', contactEmail: FACTORY_SUPPORT_EMAIL, companyCode: 'TP-ADMIN' }, user: { email: FACTORY_SUPPORT_EMAIL } };
  }

  let company = await prisma.companyProfile.findUnique({ where: { userId } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if(!company){
    company = await prisma.companyProfile.create({ data: { userId, companyName: 'Empresa', contactEmail: user?.email || null } });
  }
  return { company, user };
}

async function couponPreviewForCompany(companyId, couponCode){
  const code = String(couponCode || '').trim().toUpperCase();
  if(!code) return { code: '', discountPct: 0, valid: false, alreadyUsed: false, message: '' };
  const stored = await prisma.factoryCoupon.findUnique({ where: { code } }).catch(() => null);
  const legacyPct = LEGACY_FACTORY_COUPONS[code] || 0;
  if(stored && !stored.isActive){
    return { code, discountPct: 0, valid: false, alreadyUsed: true, message: 'Este código ya fue utilizado o desactivado.' };
  }
  const discountPct = stored ? Number(stored.discountPct || 0) : legacyPct;
  if(stored && stored.companyId && stored.companyId !== companyId){
    return { code, discountPct: 0, valid: false, alreadyUsed: false, message: 'Este código fue emitido para otra empresa.' };
  }
  if(stored?.grantsFullAccess){
    return { code, discountPct: 0, valid: false, alreadyUsed: false, message: 'Este código habilita acceso total. Activálo desde el bloque de acceso especial.' };
  }
  if(!discountPct) return { code, discountPct: 0, valid: false, alreadyUsed: false, message: 'Código no reconocido.' };
  const usedAnywhere = await prisma.billingCouponRedemption.findFirst({ where: { code } }).catch(() => null);
  if(usedAnywhere) return { code, discountPct: 0, valid: false, alreadyUsed: true, message: 'Este código ya fue utilizado y quedó desactivado.' };
  return { code, discountPct, valid: true, alreadyUsed: false, message: `${discountPct}% aplicado en esta compra.` };
}

async function buildFactoryQuote(companyId, items = [], couponCode = ''){
  const cleanItems = Array.isArray(items) ? items : [];
  const normalized = [];
  for(const item of cleanItems){
    const plan = await planByCode(item?.planCode);
    if(!plan) continue;
    const quantity = Number(plan.price || 0) <= 0
      ? 1
      : Math.max(1, Math.min(50, Number(item?.quantity || 1) || 1));
    const searchesIncluded = Number(plan.searches || 0) * quantity;
    const publicationsIncluded = Number(plan.publications || 0) * quantity;
    normalized.push({
      planCode: plan.code,
      planName: plan.name,
      days: plan.days,
      unitPrice: plan.price,
      quantity,
      subtotal: plan.price * quantity,
      openingsIncluded: searchesIncluded,
      publicationsIncluded,
      searchesPerUnit: Number(plan.searches || 0),
      publicationsPerUnit: Number(plan.publications || 0),
    });
  }
  const subtotal = normalized.reduce((acc, it)=> acc + it.subtotal, 0);
  const totalDays = normalized.reduce((acc, it)=> acc + (it.days * it.quantity), 0);
  const totalOpenings = normalized.reduce((acc, it)=> acc + it.openingsIncluded, 0);
  const totalPublications = normalized.reduce((acc, it)=> acc + it.publicationsIncluded, 0);
  const coupon = await couponPreviewForCompany(companyId, couponCode);
  const discountAmount = coupon.valid ? Math.round(subtotal * (coupon.discountPct / 100)) : 0;
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const vatAmount = Math.round(taxableBase * 0.21);
  const total = taxableBase + vatAmount;
  return {
    items: normalized,
    subtotal,
    totalDays,
    totalOpenings,
    totalPublications,
    coupon,
    discountAmount,
    vatAmount,
    total,
    currency: 'ARS',
  };
}

function orderDueDate(order){
  if(!order) return null;
  if(String(order.status || '').toUpperCase() === 'PENDING_PAYMENT'){
    return new Date(new Date(order.createdAt || Date.now()).getTime() + FACTORY_PENDING_TTL_MS);
  }
  const expiries = (order.items || []).map((item) => orderItemExpiresAt(order, item)).filter(Boolean);
  if(!expiries.length) return order.createdAt || null;
  return expiries.reduce((acc, date) => (acc && acc > date ? acc : date), null) || order.createdAt || null;
}

function orderToSummary(order){
  const isInternalTicket = String(order.paymentProvider || '').toUpperCase() === 'INTERNAL_TICKET';
  const documentNo = isInternalTicket
    ? buildInternalTicketNumber(order.id)
    : `${order.status === 'PAID' ? 'FAC' : 'ORD'}-${String(order.id).slice(-8).toUpperCase()}`;
  const docType = isInternalTicket ? 'Ticket' : (order.status === 'PAID' ? 'Factura' : 'Pedido');
  const paymentLabel = isInternalTicket
    ? 'Validado sin cargo'
    : order.status === 'PAID' ? 'Pagado' : (order.status === 'FAILED' ? 'Fallido' : (order.status === 'EXPIRED' ? 'Vencido' : (order.status === 'CANCELLED' ? 'Cancelado' : 'Pendiente')));
  const statusDisplay = isInternalTicket ? 'Activo sin cargo' : paymentLabel;
  return {
    id: order.id,
    companyName: order.companyNameSnapshot || order.company?.companyName || 'Empresa',
    companyCode: companyCodeFrom(order.company || { cuit: order.cuitSnapshot, id: order.companyId }),
    docType,
    documentNo,
    date: order.createdAt,
    dueDate: orderDueDate(order),
    status: order.status,
    amount: order.total,
    currency: 'ARS',
    paymentLabel,
    statusDisplay,
    days: order.totalDays || 0,
    totalOpenings: order.totalOpenings || 0,
    couponCode: order.couponCode || null,
    couponDiscountPct: order.couponDiscountPct || 0,
    billingName: order.billingName || null,
    billingTaxId: order.billingTaxId || null,
    billingEmail: order.billingEmail || null,
    paymentProvider: order.paymentProvider || null,
    paymentSessionRef: order.paymentSessionRef || null,
    paymentProviderRef: order.paymentProviderRef || null,
    paymentApprovedAt: order.paymentApprovedAt || null,
    paymentFailureReason: order.paymentFailureReason || null,
    paymentReceiptUrl: order.paymentReceiptUrl || null,
    createdAt: order.createdAt,
    items: (order.items || []).map((it)=> ({
      id: it.id,
      planCode: it.planCode,
      planName: it.planName,
      days: it.days,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: it.subtotal,
      openingsIncluded: it.openingsIncluded || 0,
      searchesIncluded: it.openingsIncluded || 0,
      publicationsIncluded: it.publicationsIncluded || 0,
    })),
    totals: {
      subtotal: order.subtotal || 0,
      discountAmount: order.discountAmount || 0,
      vatAmount: order.vatAmount || 0,
      total: order.total || 0,
    }
  };
}

async function ensureUploadsDir(){
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function saveCandidatePhoto(userId, buffer, ext = "jpg"){
  await ensureUploadsDir();
  const filename = safeFileName(`candidate-${userId}-${Date.now()}.${ext}`);
  const abs = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(abs, buffer);
  return `${PUBLIC_UPLOADS}/${filename}`;
}

async function deleteUploadedFile(fileUrl){
  if(!fileUrl || !String(fileUrl).startsWith(PUBLIC_UPLOADS + "/")) return;
  const abs = path.join(UPLOADS_DIR, path.basename(fileUrl));
  try{ await fs.unlink(abs); }catch{}
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
    if (req.user?.id === VIRTUAL_ADMIN_USER_ID) {
      return res.json({
        ok: true,
        user: { id: VIRTUAL_ADMIN_USER_ID, email: null, role: VIRTUAL_ADMIN_ROLE, createdAt: new Date().toISOString() },
        fullName: 'Talento PyME',
        companyName: 'Talento PyME',
        profile: null,
      });
    }
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
        province: user.candidateProfile.province || null,
        country: user.candidateProfile.country || null,
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

function requireAnyRole(roles){
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if(!allowed.includes(req.user?.role)) return res.status(403).json({ error: "No autorizado" });
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
  password: z.string().min(10).max(200),
  dni: z.string().max(20).optional(),
  companyName: z.string().max(160).optional(),
  cuit: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  phone: z.string().max(60).optional(),
  contactName: z.string().max(120).optional(),
  contactEmail: z.string().email().max(180).optional()
});

const loginSchema = z.object({
  fullName: z.string().min(2).max(120),
  password: z.string().min(8).max(200),
  roleHint: z.enum(["CANDIDATE", "COMPANY"]).optional()
});

const passwordRecoveryStartSchema = z.object({
  role: z.enum(["CANDIDATE", "COMPANY"]),
  dni: z.string().max(20).optional(),
  cuit: z.string().max(40).optional(),
  legacyEmail: z.string().email().max(180).optional(),
});
const passwordRecoveryVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});
const passwordRecoveryCompleteSchema = z.object({
  resetToken: z.string().min(20),
  newPassword: z.string().min(10).max(200),
});

const registrationAuditSchema = z.object({
  role: z.enum(["CANDIDATE", "COMPANY"]).optional(),
  eventType: z.enum(["STARTED", "CLIENT_REJECTED", "NETWORK_ERROR"]),
  reason: z.string().max(180).optional(),
});

async function writeRegistrationAudit({ role=null, eventType, outcome=null, reason=null, source='WEB' }){
  try{
    await prisma.registrationAuditEvent.create({ data:{ role: role || null, eventType, outcome: outcome || null, reason: reason ? String(reason).slice(0,180) : null, source } });
  }catch(err){
    console.warn('[REGISTRATION_AUDIT]', err?.message || err);
  }
}

app.post('/auth/register-audit', async (req,res)=>{
  const parsed = registrationAuditSchema.safeParse(req.body || {});
  if(!parsed.success) return res.status(400).json({ok:false});
  await writeRegistrationAudit({ ...parsed.data, outcome: parsed.data.eventType, source:'WEB_CLIENT' });
  return res.json({ok:true});
});

app.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  const fallbackRole = ['CANDIDATE','COMPANY'].includes(String(req.body?.role || '')) ? String(req.body.role) : null;
  const reject = async (status, error, reason=error, role=fallbackRole) => {
    await writeRegistrationAudit({ role, eventType:'RESULT', outcome:'REJECTED', reason, source:'API' });
    return res.status(status).json({ error });
  };
  const success = async (payload, role=fallbackRole, reason='OK') => {
    await writeRegistrationAudit({ role, eventType:'RESULT', outcome:'SUCCESS', reason, source:'API' });
    return res.json(payload);
  };

  if (!parsed.success) return reject(400, "Datos inválidos", 'SCHEMA_VALIDATION');

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
    country,
  } = parsed.data;

  const emailNorm = normalizeEmail(email);
  const passHash = await bcrypt.hash(password, 10);

  // Validaciones de identidad (DNI/CUIT) y unicidad
  if (role === "CANDIDATE") {
    const dniNorm = normalizeId(dni || "");
    if (!dniNorm) return reject(400, "DNI requerido", 'DNI_REQUIRED', role);
    if (!isCandidateDni(dniNorm)) return reject(400, "Ingresá un DNI válido, sin puntos. Debe tener menos de 11 dígitos.", 'DNI_INVALID', role);
    if(!String(province || '').trim()) return reject(400, "Provincia / Estado / Región requerida", 'PROVINCE_REQUIRED', role);
    if(!String(country || '').trim()) return reject(400, "País de residencia requerido", 'COUNTRY_REQUIRED', role);

    const [existingByDni, existingBolsaByDni] = await Promise.all([
      prisma.profile.findUnique({ where: { dni: dniNorm } }),
      prisma.candidateBolsa.findFirst({ where: { dni: dniNorm }, select: { id: true } }).catch(() => null),
    ]);
    if (existingByDni || existingBolsaByDni) return reject(409, "Ya existe un candidato con ese DNI", 'DNI_DUPLICATE', role);
  }

  if (role === "COMPANY") {
    const cuitNorm = normalizeId(cuit || "");
    if (!cuitNorm) return reject(400, "CUIT requerido", 'CUIT_REQUIRED', role);
    if (!isCompanyCuit(cuitNorm)) return reject(400, "Ingresá un CUIT válido de 11 dígitos.", 'CUIT_INVALID', role);

    const existingByCuit = await prisma.companyProfile.findUnique({ where: { cuit: cuitNorm } });
    if (existingByCuit) return reject(409, "Ya existe una empresa con ese CUIT", 'CUIT_DUPLICATE', role);
  }

  const registrationResidence = role === "CANDIDATE"
    ? inferResidence({ locality:city || '', province:province || '', country:country || '' })
    : { city:city || '', province:province || '', country:country || '' };

  const existingUser = await prisma.user.findUnique({
    where: { email: emailNorm },
    include: { candidateProfile: true, company: true, resume: true },
  });

  if (existingUser) {
    if (existingUser.role !== role) {
      return reject(409, "Ese email ya está registrado con otro perfil", 'EMAIL_OTHER_ROLE', role);
    }

    if (role === "CANDIDATE" && !existingUser.candidateProfile) {
      const ownsAccount = await bcrypt.compare(password, existingUser.passHash);
      if(!ownsAccount) return reject(409, "La cuenta ya existe. Ingresá con tu clave actual o usá Olvidé mi contraseña.", 'LEGACY_PASSWORD_MISMATCH', role);
      const dniNorm = normalizeId(dni || "");
      const fullNameNorm = normalizeName(fullName || "");

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          welcomeEmailQueuedAt: existingUser.welcomeEmailSentAt ? existingUser.welcomeEmailQueuedAt : new Date(),
          candidateProfile: {
            create: {
              fullName,
              fullNameNorm,
              dni: dniNorm,
              phone: phone || "",
              address: address || "",
              city: registrationResidence.city || city || "",
              province: registrationResidence.province || province || "",
              country: registrationResidence.country || country || null,
            },
          },
          ...(existingUser.resume ? {} : { resume: { create: {} } }),
        },
      });
      queueCandidateClassification(existingUser.id,'REGISTRATION_UPGRADE');

      return success({ ok: true, upgraded: true, version: APP_VERSION }, role, 'LEGACY_UPGRADE');
    }

    if (role === "COMPANY" && !existingUser.company) {
      const ownsAccount = await bcrypt.compare(password, existingUser.passHash);
      if(!ownsAccount) return reject(409, "La cuenta ya existe. Ingresá con tu clave actual o usá Olvidé mi contraseña.", 'LEGACY_PASSWORD_MISMATCH', role);
      const cuitNorm = normalizeId(cuit || "");
      const companyNameNorm = normalizeName(companyName || "");
      const contactNameNorm = normalizeName(contactName || fullName || "");

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          welcomeEmailQueuedAt: existingUser.welcomeEmailSentAt ? existingUser.welcomeEmailQueuedAt : new Date(),
          company: {
            create: {
              companyName,
              companyNameNorm,
              cuit: cuitNorm,
              contactName: contactName || fullName || "",
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

      return success({ ok: true, upgraded: true, version: APP_VERSION }, role, 'LEGACY_UPGRADE');
    }

    return reject(409, "Email ya registrado", 'EMAIL_DUPLICATE', role);
  }

  try {
    if (role === "CANDIDATE") {
      const dniNorm = normalizeId(dni || "");
      const fullNameNorm = normalizeName(fullName || "");

      const user = await prisma.user.create({
        data: {
          email: emailNorm,
          passHash,
          role,
          welcomeEmailQueuedAt:new Date(),
          candidateProfile: {
            create: {
              fullName,
              fullNameNorm,
              dni: dniNorm,
              phone: phone || "",
              address: address || "",
              city: registrationResidence.city || city || "",
              province: registrationResidence.province || province || "",
              country: registrationResidence.country || country || null,
            },
          },
          resume: { create: {} },
        },
      });
      queueCandidateClassification(user.id,'REGISTRATION');

      return success({ ok: true, userId: user.id, version: APP_VERSION }, role, 'NEW_CANDIDATE');
    }

    if (role === "COMPANY") {
      const cuitNorm = normalizeId(cuit || "");
      const companyNameNorm = normalizeName(companyName || "");
      const contactNameNorm = normalizeName(contactName || fullName || "");

      const user = await prisma.user.create({
        data: {
          email: emailNorm,
          passHash,
          role,
          welcomeEmailQueuedAt:new Date(),
          company: {
            create: {
              companyName,
              companyNameNorm,
              cuit: cuitNorm,
              contactName: contactName || fullName || "",
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

      return success({ ok: true, userId: user.id, version: APP_VERSION }, role, 'NEW_COMPANY');
    }

    return reject(400, "Rol inválido", 'ROLE_INVALID', role);
  } catch (e) {
    console.error(e);
    await writeRegistrationAudit({ role, eventType:'RESULT', outcome:'REJECTED', reason:'SERVER_ERROR', source:'API' });
    return res.status(500).json({ error: "Error registrando usuario" });
  }
});

const loginAttempts710 = new Map();
function loginThrottle710(req,res,next){
  const now=Date.now(), key=String(req.ip || req.socket?.remoteAddress || 'unknown');
  for(const [k,v] of loginAttempts710) if(v.until<=now) loginAttempts710.delete(k);
  const entry=loginAttempts710.get(key) || {count:0,until:now+15*60*1000};
  if(entry.count>=20){res.setHeader('Retry-After',String(Math.ceil((entry.until-now)/1000)));return res.status(429).json({error:'Demasiados intentos. Esperá unos minutos o recuperá tu contraseña.'});}
  if(loginAttempts710.size>=10000 && !loginAttempts710.has(key)) return res.status(429).json({error:'Intentá nuevamente en unos minutos.'});
  entry.count++;loginAttempts710.set(key,entry);next();
}
function passwordVariants710(password){
  const value=String(password || '');
  const trimmed=value.trim();
  // Tolerancia acotada: espacios exteriores y primera letra. No se corrigen caracteres internos.
  return [...new Set([value,trimmed,trimmed.charAt(0).toLowerCase()+trimmed.slice(1),trimmed.charAt(0).toUpperCase()+trimmed.slice(1)])];
}
async function verifyLoginPassword710(password,user,exactIdentity=false){
  if(!user?.passHash) return false;
  const variants=exactIdentity && ['CANDIDATE','COMPANY'].includes(user.role)?passwordVariants710(password):[password];
  for(const value of variants) if(await bcrypt.compare(value,user.passHash)) return true;
  return false;
}

app.post("/auth/login", loginThrottle710, async (req, res) => {
  try {
  const parsed = loginSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fullName, password, roleHint } = parsed.data;

  const identifier = fullName.trim();

  const normalizedIdentifier = normalizeName(identifier);
  if (FACTORY_ADMIN_ALIAS && FACTORY_ADMIN_PASSWORD && normalizedIdentifier === normalizeName(FACTORY_ADMIN_ALIAS)) {
    const okAdmin = password === FACTORY_ADMIN_PASSWORD;
    if (!okAdmin) return res.status(401).json({ error: 'Clave incorrecta' });
    return res.json({ token: signToken({ id: VIRTUAL_ADMIN_USER_ID, role: VIRTUAL_ADMIN_ROLE }), role: VIRTUAL_ADMIN_ROLE, admin: true });
  }

  // v7.10.10: para candidatos el acceso se identifica únicamente por nombre y apellido.
  // Se conserva la normalización del nombre (mayúsculas/minúsculas, acentos y espacios).
  if(roleHint === 'CANDIDATE' && (/^[\d.\s-]+$/.test(identifier) || identifier.includes("@"))){
    return res.status(401).json({ error: "Ingresá tu nombre y apellido tal como fueron registrados." });
  }

  // Empresas conservan el acceso por correo cuando seleccionan el rol Empresa.
  if(identifier.includes("@")){
    const emailTry = identifier.toLowerCase();
    const u = await prisma.user.findFirst({ where: { email: { equals: emailTry, mode: "insensitive" } } });
    if(!u) return res.status(401).json({ error: "No encontramos ese email. Verificá cómo te registraste." });
    const ok = (!roleHint || u.role === roleHint) && await verifyLoginPassword710(password,u,true);
    if(!ok) return res.status(401).json({ error: "Clave incorrecta. Revisá mayúsculas o usá «Olvidé mi contraseña»." });
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
  if(!candidates.some(item=>item.score>=0.85) && nameNorm.length >= 4){
    candidates.length=0;
    const take = 5000;

    if(roleHint !== "COMPANY"){
      const recentCand = await prisma.profile.findMany({
        where: { user: { role: "CANDIDATE" } },
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

  for(let i=candidates.length-1;i>=0;i--) if(!['CANDIDATE','COMPANY'].includes(candidates[i].user?.role)) candidates.splice(i,1);
  if(!candidates.length) return res.status(401).json({error:'No pudimos validar el acceso.'});
  candidates.sort((a,b) => b.score - a.score);
  const best = candidates[0];

  // criterio 70%
  if(best.score < 0.70){
    return res.status(401).json({ error: "Nombre no coincide lo suficiente." });
  }

  // si hay otro muy cerca (ambigüedad), pedimos más precisión
  const second = candidates[1];
  if(second && (best.score - second.score) < 0.03 && second.score >= 0.70){
    return res.status(409).json({ error: "Nombre ambiguo. Escribí el nombre completo (incluyendo segundo nombre y apellido) para ingresar." });
  }

  const ok = await verifyLoginPassword710(password,best.user,best.score===1);
  if(!ok) return res.status(401).json({ error: "Clave incorrecta. Revisá mayúsculas o usá «Olvidé mi contraseña»." });

  return res.json({ token: signToken(best.user), role: best.user.role });
  } catch(err) { console.error('login failed',err?.name); return res.status(500).json({error:'No se pudo ingresar. Intentá nuevamente.'}); }
});

app.post("/auth/password-recovery/start", loginThrottle710, async (req, res) => {
  const parsed = passwordRecoveryStartSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error: "Datos inválidos para iniciar la recuperación." });
  try {
    const { role } = parsed.data;
    let user = null;
    let requestedIdentifier = null;
    let pendingDni = null;
    let legacyMigration = false;

    if(role === "CANDIDATE"){
      const dni = normalizeId(parsed.data.dni || "");
      requestedIdentifier = dni;
      if(!isCandidateDni(dni)) return res.status(400).json({ error: "Ingresá tu DNI sin puntos. Debe tener menos de 11 dígitos." });

      const directProfile = await prisma.profile.findFirst({ where:{ dni }, include:{ user:true } });
      if(directProfile?.user?.role === "CANDIDATE") user = directProfile.user;
      if(!user){
        const directBolsa = await prisma.candidateBolsa.findFirst({ where:{ dni }, include:{ user:true } }).catch(() => null);
        if(directBolsa?.user?.role === "CANDIDATE") user = directBolsa.user;
      }

      if(!user && parsed.data.legacyEmail){
        const email = normalizeEmail(parsed.data.legacyEmail);
        const legacyUser = await prisma.user.findFirst({
          where:{ email:{ equals:email, mode:"insensitive" }, role:"CANDIDATE" },
          include:{ candidateProfile:true, candidateBolsa:true },
        });
        const oldIds = [legacyUser?.candidateProfile?.dni, legacyUser?.candidateBolsa?.dni].filter(Boolean);
        const hasLegacyRegistration = oldIds.some(isLegacyCandidateIdentifier);
        if(legacyUser && hasLegacyRegistration){
          const [otherProfile, otherBolsa] = await Promise.all([
            prisma.profile.findFirst({ where:{ dni, userId:{ not:legacyUser.id } }, select:{ id:true } }),
            prisma.candidateBolsa.findFirst({ where:{ dni, userId:{ not:legacyUser.id } }, select:{ id:true } }).catch(() => null),
          ]);
          if(otherProfile || otherBolsa) return res.status(409).json({ error:"Ese DNI ya está asociado a otra cuenta. Comunicate con soporte." });
          user = legacyUser;
          pendingDni = dni;
          legacyMigration = true;
        }
      }

      if(!user){
        return res.status(409).json({
          error:"LEGACY_EMAIL_REQUIRED",
          message:"Si tu cuenta fue creada con la versión anterior, ingresá por única vez el correo que declaraste al registrarte para vincular tu DNI.",
          legacyEmailRequired:true,
        });
      }
    } else {
      const cuit = normalizeId(parsed.data.cuit || "");
      requestedIdentifier = cuit;
      if(!isCompanyCuit(cuit)) return res.status(400).json({ error:"Ingresá un CUIT válido de 11 dígitos." });
      const company = await prisma.companyProfile.findFirst({ where:{ cuit }, include:{ user:true } });
      if(company?.user?.role === "COMPANY") user = company.user;
      if(!user) return res.status(404).json({ error:"No pudimos iniciar la recuperación con los datos ingresados." });
    }

    const created = await createPasswordRecoveryChallenge({ user, role, requestedIdentifier, pendingDni });
    return res.json({ ok:true, challengeId:created.challengeId, maskedEmail:created.maskedEmail, expiresInMinutes:PASSWORD_RESET_CODE_TTL_MINUTES, legacyMigration });
  } catch (err) {
    console.error("POST /auth/password-recovery/start", err?.code || err?.message || err);
    if(err?.code === "MAIL_NOT_CONFIGURED" || err?.message === "MAIL_NOT_CONFIGURED") return res.status(503).json({ error:"El correo seguro todavía no está configurado en el servidor." });
    if(err?.code === "RATE_LIMIT") return res.status(429).json({ error:err.message });
    if(isMailTransportNetworkError(err)) {
      console.error("MAIL_TRANSPORT_UNAVAILABLE: no se pudo abrir conexión SMTP con Gmail", err?.code || err?.message || err);
      return res.status(503).json({ error:"No se pudo conectar con el servicio de correo. Intentá nuevamente más tarde o comunicate con soporte." });
    }
    return res.status(500).json({ error:"No se pudo enviar el código de seguridad." });
  }
});

app.post("/auth/password-recovery/verify", async (req, res) => {
  const parsed = passwordRecoveryVerifySchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error:"Código inválido." });
  const challenge = await prisma.passwordResetChallenge.findUnique({ where:{ id:parsed.data.challengeId } });
  if(!challenge || challenge.consumedAt) return res.status(400).json({ error:"La solicitud ya no es válida. Iniciá nuevamente la recuperación." });
  if(new Date(challenge.expiresAt).getTime() < Date.now()) return res.status(410).json({ error:"El código venció. Solicitá uno nuevo." });
  if(challenge.attempts >= challenge.maxAttempts) return res.status(429).json({ error:"Se alcanzó el máximo de intentos. Solicitá un código nuevo." });
  const expected = passwordCodeHash(challenge.id, parsed.data.code);
  if(!safeEqualHex(challenge.codeHash, expected)){
    await prisma.passwordResetChallenge.update({ where:{ id:challenge.id }, data:{ attempts:{ increment:1 } } }).catch(() => null);
    return res.status(400).json({ error:"El código no es correcto." });
  }
  const verifiedAt = new Date();
  await prisma.passwordResetChallenge.update({ where:{ id:challenge.id }, data:{ verifiedAt } });
  const resetToken = jwt.sign({ sub:challenge.userId, purpose:"PASSWORD_RESET", challengeId:challenge.id }, JWT_SECRET, { expiresIn:"15m" });
  return res.json({ ok:true, resetToken });
});

app.post("/auth/password-recovery/complete", async (req, res) => {
  const parsed = passwordRecoveryCompleteSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({ error:"La nueva contraseña debe tener al menos 10 caracteres." });
  try {
    const decoded = jwt.verify(parsed.data.resetToken, JWT_SECRET);
    if(decoded?.purpose !== "PASSWORD_RESET" || !decoded?.challengeId || !decoded?.sub) return res.status(400).json({ error:"Autorización de recuperación inválida." });
    const challenge = await prisma.passwordResetChallenge.findUnique({ where:{ id:String(decoded.challengeId) } });
    if(!challenge || challenge.userId !== String(decoded.sub) || !challenge.verifiedAt || challenge.consumedAt) return res.status(400).json({ error:"La recuperación ya no es válida." });
    if(new Date(challenge.expiresAt).getTime() < Date.now()) return res.status(410).json({ error:"La recuperación venció. Solicitá un nuevo código." });
    const passHash = await bcrypt.hash(parsed.data.newPassword, 10);
    let dniUpdated = false;
    await prisma.$transaction(async (tx) => {
      if(challenge.pendingDni){
        const dni = normalizeId(challenge.pendingDni);
        if(!isCandidateDni(dni)) throw new Error("PENDING_DNI_INVALID");
        const otherProfile = await tx.profile.findFirst({ where:{ dni, userId:{ not:challenge.userId } }, select:{ id:true } });
        const otherBolsa = await tx.candidateBolsa.findFirst({ where:{ dni, userId:{ not:challenge.userId } }, select:{ id:true } }).catch(() => null);
        if(otherProfile || otherBolsa) throw new Error("DNI_ALREADY_USED");
        await tx.profile.updateMany({ where:{ userId:challenge.userId }, data:{ dni } });
        await tx.candidateBolsa.updateMany({ where:{ userId:challenge.userId }, data:{ dni } });
        dniUpdated = true;
      }
      await tx.user.update({ where:{ id:challenge.userId }, data:{ passHash } });
      await tx.passwordResetChallenge.update({ where:{ id:challenge.id }, data:{ consumedAt:new Date() } });
      await tx.passwordResetChallenge.updateMany({ where:{ userId:challenge.userId, id:{ not:challenge.id }, consumedAt:null }, data:{ consumedAt:new Date() } });
    });
    return res.json({ ok:true, dniUpdated });
  } catch (err) {
    if(err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") return res.status(400).json({ error:"La autorización venció. Iniciá nuevamente la recuperación." });
    if(err?.message === "DNI_ALREADY_USED") return res.status(409).json({ error:"Ese DNI ya está asociado a otra cuenta. Comunicate con soporte." });
    console.error("POST /auth/password-recovery/complete", err);
    return res.status(500).json({ error:"No se pudo actualizar la contraseña." });
  }
});

// Compatibilidad defensiva: las versiones viejas ya no pueden cambiar contraseñas sólo con DNI/CUIT.
app.post("/auth/reset-by-id", (_req, res) => res.status(410).json({ error:"Este método fue reemplazado por recuperación segura mediante correo electrónico. Actualizá la aplicación." }));

// -----------------------------
// Profile (candidato)
// -----------------------------
const profileSchema = z.object({
  fullName: z.string().max(120).optional().nullable(),
  dni: z.string().max(20).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  province: z.string().max(80).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  headline: z.string().max(140).optional().nullable(),
  sector: z.string().max(80).optional().nullable(),
  subSector: z.string().max(120).optional().nullable(),
  skillsText: z.string().max(8000).optional().nullable()
});


function validBirthDate710(value){
  if(value==='') return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value && value>='1900-01-01' && value<=new Date().toISOString().slice(0,10);
}
const bolsaSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  dni: z.string().min(4).max(20),
  nacionalidad: z.string().max(80),
  estadoCivil: z.string().max(40),
  hijos: z.string().max(40),
  telefono: z.string().max(40),
  telefonoAdicional: z.string().max(40).optional().nullable(),
  fechaNacimiento: z.string().refine(validBirthDate710, "Fecha de nacimiento inválida").optional().nullable(),
  correo: z.string().email().max(160),
  localidad: z.string().max(80),
  provinciaResidencia: z.string().max(80).optional().nullable(),
  paisResidencia: z.string().max(80).optional().nullable(),
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
  observaciones: z.string().max(12000).optional().nullable(),
  voiceNarrativeRaw: z.string().max(8000).optional().nullable(),
  voiceNarrativeSummary: z.string().max(8000).optional().nullable(),
  voiceNarrativeAnalysisVersion: z.string().max(80).optional().nullable(),
  voiceNarrativeAnalysisSource: z.string().max(80).optional().nullable(),
  voiceNarrativeYears: z.number().int().min(0).max(65).optional().nullable(),
  voiceNarrativeProfessionalTitle: z.string().max(180).optional().nullable(),
  voiceNarrativeStrengths: z.array(z.string().max(240)).max(10).optional().nullable(),
  voiceNarrativeMotivation: z.string().max(1600).optional().nullable(),
  voiceNarrativeClosing: z.string().max(2400).optional().nullable(),
  voiceNarrativeAnalyzedAt: z.string().datetime().optional().nullable().transform((v)=>v ? new Date(v) : null),

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

app.get("/profile/me", auth, requireRole("CANDIDATE"), async (req, res) => {
  const p = await prisma.profile.findUnique({ where: { userId: req.user.id }, include: { skills: true } });
  res.json(p || null);
});

app.put("/profile/me", auth, requireRole("CANDIDATE"), async (req, res) => {
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
  if(req.user.role === 'CANDIDATE') queueCandidateClassification(req.user.id,'PROFILE_UPDATED');
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



function collapseSpacedLetters(text=""){
  let out = String(text || "");
  out = out.replace(/\b(?:[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\s+){3,}[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\b/g, (m) => m.replace(/\s+/g, ""));
  out = out.replace(/-\s*\n\s*/g, "");
  return out;
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
  return buildCandidateAdminClassification({resume:{experience:sections?.experience || '',education:sections?.education || ''}}).profileTitle;
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
  const explicit = [];
  for (const rx of patterns){
    for(const m of hay.matchAll(rx)) explicit.push(Number(m[1]));
  }
  const years = [];
  for(const e of (entries || [])){
    for(const y of (e.years || [])) years.push(Number(y));
  }
  if(years.length >= 2){
    const span = Math.max(...years) - Math.min(...years);
    if(Number.isFinite(span) && span > 0){
      const inclusive = span;
      if(explicit.length){
        const top = Math.max(...explicit);
        if(Math.abs(inclusive - top) <= 10) return Math.max(inclusive, top);
        return top;
      }
      return inclusive;
    }
  }
  return explicit.length ? Math.max(...explicit) : null;
}

function escapeRegExp(s=""){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeEmployer(v=""){
  const s = normalizeSpaces(v);
  if(!s) return false;
  if(/^(perfil|experiencia profesional|formacion academica|certificaciones|competencias clave)$/i.test(s)) return false;
  if(/@|linkedin|hotmail|gmail/i.test(s)) return false;
  if(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|presente|actualidad)\b/i.test(s)) return false;
  if(/\b(jefe|lider|líder|responsable|representante|supervisor|consultor|planner|project manager|tecnico|técnico|especialista|operaciones)\b/i.test(s) && !/\b(s\.a\.|sa|srl|inc|corp|company|softys|monsanto|big dutchman|dva argentina|tecno logisti-k|bld\+)\b/i.test(s)) return false;
  return s.length >= 2;
}

function extractStandaloneEmployers(sections){
  const src = pickSectionText(sections, ["experience"]) || "";
  const lines = splitLinesStrong(src);
  const out = [];
  for(const line of lines){
    if(!/\|/.test(line)) continue;
    const employer = normalizeSpaces(line.split('|')[0] || "");
    if(looksLikeEmployer(employer)) out.push(employer);
  }
  return uniq(out);
}

function cleanSummaryText(v=""){
  return splitLinesStrong(v)
    .filter(line => !/@|linkedin|hotmail|gmail|www\.|http/i.test(line))
    .filter(line => !/^\+?\d[\d\s\-()]{6,}$/.test(line))
    .filter(line => !/^(zarate|zárate|campana|pilar|rosario),?/i.test(line))
    .filter(line => !/^(perfil|experiencia profesional|formacion academica|certificaciones y formacion complementaria|competencias clave)$/i.test(normalizeName(line)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function detectCompaniesAndSites(entries, sections){
  const employers = [];
  for(const e of (entries || [])){
    if(looksLikeEmployer(e.employer)) employers.push(normalizeSpaces(e.employer));
  }
  employers.push(...extractStandaloneEmployers(sections));

  const sites = [];
  for(const e of (entries || [])){
    if(e.location){
      for(const part of e.location.split(/,/).map(s => normalizeSpaces(s)).filter(Boolean)){
        if(part.length >= 3) sites.push(part);
      }
    }
    const full = `${e.header} ${e.dateLine} ${(e.bullets||[]).join(' ')}`;
    const matches = full.match(/planta\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+/gi) || [];
    for(const m of matches) sites.push(normalizeSpaces(m));
  }
  return { employers: uniq(employers).slice(0,10), sites: uniq(sites).slice(0,10) };
}

function detectRecentRoles(entries){
  return (entries || []).slice(0,5).map(e => {
    const bits = [e.role || e.header, e.employer, e.location].filter(Boolean);
    return bits.join(" — ");
  });
}

function optimizeProfessionalSummary(text, sections, analysis){
  const summary = cleanSummaryText(sections?.summary || "");
  const recent = analysis.recentRoles || [];
  const strengths = analysis.strengths || [];
  const skills = analysis.skills || [];
  const industries = analysis.industries || [];
  const employers = analysis.employers || [];
  const sites = analysis.sites || [];
  const years = analysis.yearsExperience;
  const profession = analysis.profession;
  const lines = [];

  let intro = profession || "Perfil laboral por completar";
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

  return lines.join("\n\n");
}

function analyzeResumeText(text, sections){
  const entries = extractExperienceEntries(text, sections);
  const companyData = detectCompaniesAndSites(entries, sections);
  const analysis = {
    entries,
    profession: detectProfession(text, sections, entries),
    yearsExperience: candidateEvidenceYears(candidateEvidenceLines(sections?.experience || "")).years,
    recentRoles: detectRecentRoles(entries),
    skills: detectCoreSkills(text, sections, entries),
    strengths: inferProfessionalStrengthsLocal(sections?.experience || ""),
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
  lines.push(`Perfil detectado: ${a.profession || "Perfil laboral por completar"}`);
  if (a.yearsExperience) lines.push(`Experiencia estimada: +${a.yearsExperience} años`);
  if (a.industries?.length) lines.push(`Industrias detectadas: ${a.industries.join(" | ")}`);
  if (a.employers?.length) lines.push(`Empresas detectadas: ${a.employers.join(" | ")}`);
  if (a.sites?.length) lines.push(`Plantas / sedes mencionadas: ${a.sites.join(" | ")}`);
  if (a.skills?.length) lines.push(`Ranking de habilidades: ${a.skills.map((s, i) => `${i+1}. ${s}`).join(" | ")}`);
  if (a.recentRoles?.length) lines.push(`Cargos recientes detectados: ${a.recentRoles.join(" | ")}`);
  lines.push("");
  lines.push("Resumen profesional optimizado:");
  lines.push(a.summary || "");
  return lines.join("\n");
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
    const err = new Error("UNSUPPORTED_RESUME_FORMAT");
    err.code = "UNSUPPORTED_RESUME_FORMAT";
    throw err;
  }
  return cleanTextForAnalysis(collapseSpacedLetters(raw));
}

app.post("/resume/parse", auth, requireRole("CANDIDATE"), upload.single("file"), async (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: "Falta adjuntar archivo (PDF/DOCX/TXT)." });
    const text = await extractTextFromUpload(req.file);
    if(!text || text.trim().length < 20){
      return res.status(400).json({ error: "No pudimos leer texto del archivo. Probá con PDF, DOCX o TXT que contenga texto seleccionable." });
    }
    const sections = splitByHeadings(text);
    const personalLines=text.split(/\r?\n/).filter(line=>/fecha de nacimiento|nacimiento\s*:|tel[eé]fono|celular|domicilio|direcci[oó]n|estado civil/i.test(line));
    sections.observations=[...new Set([sections.observations,...personalLines].filter(Boolean))].join('\n');
    const analysis = analyzeResumeText(text, sections);
    const summaryText = buildResumeSummary(text, sections, analysis);

    // v7.8.7: conservar el contenido útil del CV en Resume apenas se procesa.
    // El archivo original sigue sin persistirse; sólo se guardan texto extraído y resumen.
    const resumeData = {
      summary: clampText(summaryText || analysis?.summary || sections?.summary || "", 12000) || null,
      experience: String(sections?.experience || "").trim().slice(0, 20000) || null,
      education: String(sections?.education || "").trim().slice(0, 12000) || null,
      certifications: String(sections?.certifications || "").trim().slice(0, 12000) || null,
      observations: String(sections?.observations || "").trim().slice(0, 12000) || null,
    };
    const savedResume = await prisma.resume.upsert({
      where: { userId: req.user.id },
      update: resumeData,
      create: { userId: req.user.id, ...resumeData },
    });

    // v7.9.11: un CV nuevo o actualizado debe volver a fusionarse explícitamente con la presentación personal.
    // Conservamos el texto aprobado, pero marcamos el análisis como pendiente hasta que el candidato pulse
    // “Corrección IA profesional”; nunca se ejecuta IA automáticamente al guardar o cargar el archivo.
    await prisma.candidateBolsa.updateMany({
      where:{ userId:req.user.id },
      data:{ voiceNarrativeAnalysisVersion:null, voiceNarrativeAnalysisSource:'CV_UPDATED_REQUIRES_REFINEMENT', voiceNarrativeAnalyzedAt:null },
    }).catch(()=>null);

    queueCandidateClassification(req.user.id,'CV_PARSED');
    return res.json({ ok:true, sections, analysis, summaryText, resume: savedResume, presentationNeedsRefinement:true });
  }catch(err){
    if(err?.code === "UNSUPPORTED_RESUME_FORMAT" || err?.message === "UNSUPPORTED_RESUME_FORMAT"){
      return res.status(415).json({ error: "Formato no admitido. Usá PDF, DOCX o TXT." });
    }
    console.error("resume/parse error:", err);
    return res.status(500).json({ error: "Error al procesar el archivo." });
  }
});

app.get("/resume/me", auth, requireRole("CANDIDATE"), async (req, res) => {
  const r = await prisma.resume.findUnique({ where: { userId: req.user.id } });
  res.json(r || null);
});

app.put("/resume/me", auth, requireRole("CANDIDATE"), async (req, res) => {
  const parsed = resumeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const r = await prisma.resume.upsert({
    where: { userId: req.user.id },
    update: data,
    create: { userId: req.user.id, ...data }
  });
  await prisma.candidateBolsa.updateMany({
    where:{ userId:req.user.id },
    data:{ voiceNarrativeAnalysisVersion:null, voiceNarrativeAnalysisSource:'CV_UPDATED_REQUIRES_REFINEMENT', voiceNarrativeAnalyzedAt:null },
  }).catch(()=>null);
  if(req.user.role === 'CANDIDATE') queueCandidateClassification(req.user.id,'CV_UPDATED');
  res.json(r);
});


// -----------------------------
// Presentación personal por voz / texto (candidato)
// -----------------------------
const candidatePresentationSchema = z.object({
  transcript: z.string().min(5).max(8000),
});

function professionalNorm(value=''){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9+]+/g,' ').replace(/\s+/g,' ').trim();
}

function presentationSentences(text=''){
  return String(text || '')
    .replace(/\b(hola|buenas tardes|buenos dias|buen día|buenas noches|bueno mira|bueno|mira|eee+|mmm+|este+|digamos|o sea|viste)\b[,.]?/gi, ' ')
    .replace(/(?:\betc[eé]tera\b[,.]?\s*){1,}/gi, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\s*[;\n]+\s*/)
    .map((row) => row.trim().replace(/^[,.;:\-\s]+|[,;:\-\s]+$/g, ''))
    .filter((row) => row.length >= 4);
}

function normalizePresentationSentence(row=''){
  const clean = String(row || '').replace(/\s+/g, ' ').trim();
  if(!clean) return '';
  const first = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function extractExplicitYearsFromText(text=''){
  const raw=professionalNorm(text);
  const candidates=[];
  const patterns=[
    /(?:mas de|alrededor de|aproximadamente|cerca de|unos|casi)?\s*(\d{1,2})\s*anos(?:\s+de)?\s+(?:experiencia|trayectoria|trabajo|actividad|rubro)/g,
    /(?:experiencia|trayectoria|trabaj(?:e|o|ando)|actividad)(?:\s+de|\s+por|\s+durante)?\s*(?:mas de|alrededor de|aproximadamente|cerca de|unos|casi)?\s*(\d{1,2})\s*anos/g,
    /(?:tengo|cuento con|poseo)\s*(?:mas de|alrededor de|aproximadamente|cerca de|unos|casi)?\s*(\d{1,2})\s*anos/g,
  ];
  for(const rx of patterns){
    for(const m of raw.matchAll(rx)){
      const n=Number(m[1]);
      if(Number.isFinite(n) && n>=0 && n<=65) candidates.push(n);
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
}

function experienceRangeFromYears(years){
  const n=Number(years);
  if(!Number.isFinite(n)) return '';
  if(n <= 1) return '0–1';
  if(n <= 5) return '2–5';
  if(n <= 10) return '6–10';
  if(n <= 20) return '11–20';
  if(n <= 30) return '21–30';
  return '31+';
}


function normalizeCvYear(yearValue, nowYear = new Date().getFullYear()){
  const raw=String(yearValue ?? '').trim().toLowerCase();
  if(!raw) return null;
  if(/actualidad|actual|presente|hoy|current|present/.test(raw)) return nowYear;
  const n=Number(raw);
  if(!Number.isFinite(n)) return null;
  if(n >= 1900 && n <= nowYear + 1) return n;
  if(n >= 0 && n <= 99){
    const pivot=(nowYear % 100) + 1;
    return n <= pivot ? 2000 + n : 1900 + n;
  }
  return null;
}

function estimateExperienceYearsFromResumeDates(text=''){
  const raw=String(text || '').replace(/[‐‑‒–—]/g,'-');
  if(!raw.trim()) return { years:null, intervalsCount:0, basis:'' };
  const now=new Date();
  const nowYear=now.getFullYear();
  const nowMonth=now.getMonth()+1;
  const intervals=[];
  const addInterval=(startYear,startMonth,endYear,endMonth)=>{
    const sy=normalizeCvYear(startYear,nowYear);
    const ey=normalizeCvYear(endYear,nowYear);
    if(!sy || !ey || ey < sy || sy < 1950 || ey > nowYear + 1) return;
    const sm=Math.max(1,Math.min(12,Number(startMonth)||1));
    const em=Math.max(1,Math.min(12,Number(endMonth)||12));
    const start=(sy*12)+(sm-1);
    const end=(ey*12)+(em-1);
    if(end < start || (end-start) > 65*12) return;
    intervals.push([start,end]);
  };

  // Ejemplos: 1998-2012 / 2012-presente.
  const yearRange=/\b((?:19|20)\d{2})\s*(?:-|\ba\b|\bal\b|\bhasta\b|\bto\b)\s*((?:19|20)\d{2}|actualidad|actual|presente|hoy|current|present)\b/gi;
  for(const m of raw.matchAll(yearRange)){
    const endToken=String(m[2] || '').toLowerCase();
    addInterval(m[1],1,m[2],/actualidad|actual|presente|hoy|current|present/.test(endToken)?nowMonth:12);
  }

  // Ejemplos: 04/24-01/26 / 05/2010-actualidad.
  const monthRange=/\b(0?[1-9]|1[0-2])[\/.](\d{2,4})\s*(?:-|\ba\b|\bal\b|\bhasta\b|\bto\b)\s*(?:(0?[1-9]|1[0-2])[\/.])?(\d{2,4}|actualidad|actual|presente|hoy|current|present)\b/gi;
  for(const m of raw.matchAll(monthRange)){
    const endToken=String(m[4] || '').toLowerCase();
    addInterval(m[2],m[1],m[4],m[3] || (/actualidad|actual|presente|hoy|current|present/.test(endToken)?nowMonth:12));
  }

  if(intervals.length){
    intervals.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
    const merged=[];
    for(const interval of intervals){
      const last=merged[merged.length-1];
      if(!last || interval[0] > last[1] + 1) merged.push([...interval]);
      else last[1]=Math.max(last[1],interval[1]);
    }
    const months=merged.reduce((sum,[a,b])=>sum+(b-a+1),0);
    const years=Math.max(1,Math.min(65,Math.round(months/12)));
    return { years, intervalsCount:intervals.length, basis:`${intervals.length} período(s) laboral(es) fechado(s) detectado(s) en el CV` };
  }

  // Respaldo: si la sección Experiencia contiene varios años, usa el tramo cronológico.
  const years=[...raw.matchAll(/\b((?:19|20)\d{2})\b/g)]
    .map((m)=>Number(m[1]))
    .filter((y)=>y>=1950 && y<=nowYear+1);
  if(years.length>=2){
    const min=Math.min(...years), max=Math.max(...years);
    const span=max-min;
    if(span>=2 && span<=65) return { years:span, intervalsCount:0, basis:'Tramo cronológico detectado en la sección de experiencia del CV' };
  }
  return { years:null, intervalsCount:0, basis:'' };
}

function candidateExperienceEvidence(candidate = {}){
  const bolsa=candidate.candidateBolsa || {};
  const resume=candidate.resume || {};
  const voiceText=[bolsa.voiceNarrativeRaw,bolsa.voiceNarrativeSummary,bolsa.observaciones].filter(Boolean).join(' ');
  const cvText=[resume.summary,resume.experience,resume.observations].filter(Boolean).join(' ');
  const storedYears=Number(bolsa.voiceNarrativeYears);
  const candidates=[];
  if(Number.isFinite(storedYears) && storedYears>=0 && storedYears<=65) candidates.push({years:storedYears,source:'Presentación personal procesada'});
  const voiceYears=extractExplicitYearsFromText(voiceText);
  if(voiceYears!==null) candidates.push({years:voiceYears,source:'Años explícitos en la presentación personal'});
  const cvExplicitYears=extractExplicitYearsFromText(cvText);
  if(cvExplicitYears!==null) candidates.push({years:cvExplicitYears,source:'Años explícitos en el CV / antecedentes curriculares'});
  const cvDates=estimateExperienceYearsFromResumeDates(resume.experience || '');
  if(cvDates.years!==null) candidates.push({years:cvDates.years,source:cvDates.basis || 'Fechas laborales del CV'});
  candidates.sort((a,b)=>b.years-a.years);
  const best=candidates[0] || null;
  const resumeExperienceLength=String(resume.experience || '').trim().length;
  const resumeSummaryLength=String(resume.summary || '').trim().length;
  const cvStrong=!!(cvDates.years!==null || cvExplicitYears!==null || resumeExperienceLength>=260 || resumeSummaryLength>=220);
  const sources=[];
  if(String(resume.summary || resume.experience || resume.education || resume.certifications || resume.observations || '').trim()) sources.push('CV / antecedentes curriculares');
  if(String(bolsa.voiceNarrativeSummary || bolsa.voiceNarrativeRaw || '').trim()) sources.push('Presentación personal');
  if(String(bolsa.areaTrabajo || bolsa.especialidad || bolsa.ultimoTrabajo || bolsa.rangoExperiencia || '').trim()) sources.push('Perfil declarado');
  return {
    years:best?.years ?? null,
    source:best?.source || '',
    cvYears:cvExplicitYears ?? cvDates.years ?? null,
    cvIntervalsCount:cvDates.intervalsCount || 0,
    cvStrong,
    sources,
  };
}

function inferLocalProfessionalTitle(text='', context={}){
  const raw=String(text || '');
  const n=professionalNorm(raw);
  const rules=[
    [/ingenier[oa]\s+electromecan|electromecanic/, 'Ingeniería Electromecánica'],
    [/ingenier[oa]\s+electric|ingenieria electric/, 'Ingeniería Eléctrica'],
    [/ingenier[oa]\s+mecanic|ingenieria mecanic/, 'Ingeniería Mecánica'],
    [/proyectista/, 'Proyectista'],
    [/supervisor/, 'Supervisión'],
    [/jefe|jefatura/, 'Jefatura'],
    [/tecnic[oa]/, 'Perfil técnico'],
    [/administrativ|administracion/, 'Administración'],
  ];
  const hits=rules.filter(([rx])=>rx.test(n)).map(([,label])=>label);
  if(hits.length>=2) return `${hits[0]} · ${hits[1]}`;
  if(hits.length) return hits[0];
  return String(context?.recentRole || context?.expertise || 'Perfil profesional').trim();
}

function inferLocalExpertise(text='', context={}){
  const n=professionalNorm(text);
  const rules=[
    [/electrica|electricista|alta tension|media tension|tabler|protecciones/, 'Eléctrica'],
    [/electromecan|termomecan|aire acondicionado|hvac/, 'Electromecánica / Termomecánica'],
    [/proyecto|proyectista|ingenieria|oficina tecnica|calcul/, 'Ingeniería / Oficina técnica'],
    [/mantenimiento/, 'Mantenimiento'],
    [/produccion|operaciones|manufactura/, 'Producción / Operaciones'],
    [/logistica|transporte|comex/, 'Logística / Transporte / Comex'],
    [/calidad|hse|seguridad higiene/, 'Calidad / HSE'],
    [/administracion|administrativ/, 'Administración'],
  ];
  for(const [rx,label] of rules){ if(rx.test(n)) return label; }
  return String(context?.expertise || '').trim();
}

function candidateRoleKnowledgeHints(text='', context={}){
  const n=professionalNorm(`${text} ${context?.recentRole || ''} ${context?.expertise || ''}`);
  const hints=[];
  if(/proyectista|proyecto|ingenieria|oficina tecnica/.test(n) && /electric|electromecan/.test(n)){
    hints.push('Proyectos eléctricos: ingeniería conceptual, básica y de detalle; esquemas unifilares y trifilares; planos de canalizaciones, tendidos y distribución; ubicación de tableros y equipos; cálculos de carga y demanda; dimensionamiento de conductores y protecciones; caída de tensión; criterios de puesta a tierra; especificaciones y documentación técnica; coordinación con otras disciplinas. Usar sólo los elementos compatibles con lo que la persona declaró y, cuando se amplíe por conocimiento del rol, redactar con prudencia (por ejemplo: “según el alcance de cada proyecto”).');
  }
  if(/supervis|jefe|coordin/.test(n)){
    hints.push('Supervisión técnica: seguimiento de ejecución, coordinación de equipos y contratistas, verificación contra planos/especificaciones, control de calidad y seguridad, seguimiento de plazos y avances, resolución de desvíos técnicos, inspecciones y acompañamiento de pruebas o puesta en servicio cuando corresponda. No atribuir cantidad de personas, presupuesto, obras ni resultados no declarados.');
  }
  if(/aire acondicionado|hvac|termomecan/.test(n)){
    hints.push('Instalaciones termomecánicas/HVAC: cálculos y dimensionamiento, definición técnica de instalaciones y equipos, coordinación electromecánica e interfaces con alimentación eléctrica y otras disciplinas. No atribuir software, marcas, capacidades o normas específicas no declaradas.');
  }
  if(/instrument|automat|plc|control/.test(n)){
    hints.push('Instrumentación/automatización: interpretación de lazos y señales, documentación de instrumentos, coordinación de interfaces de control, pruebas funcionales, diagnóstico y seguimiento técnico, sólo cuando sea compatible con el relato.');
  }
  if(/mantenimiento/.test(n)){
    hints.push('Mantenimiento: planificación y seguimiento de tareas preventivas/correctivas, análisis de fallas, coordinación de intervenciones, seguridad, documentación y mejora de confiabilidad, sólo cuando sea compatible con el relato.');
  }
  if(/produccion|operaciones|manufactura/.test(n)){
    hints.push('Producción/operaciones: seguimiento de procesos, coordinación operativa, productividad, calidad, seguridad, resolución de desvíos y mejora continua, sólo si es coherente con la experiencia declarada.');
  }
  if(/calidad|hse|seguridad|higiene|ambiente/.test(n)){
    hints.push('Calidad/HSE: seguimiento de procedimientos, inspecciones, identificación de desvíos, documentación, acciones correctivas/preventivas, seguridad y mejora continua, sin atribuir certificaciones o normas no mencionadas.');
  }
  if(/logistica|transporte|comex|deposito|almacen/.test(n)){
    hints.push('Logística/Transporte/Comex: planificación y seguimiento de movimientos, coordinación de entregas y recursos, trazabilidad documental, control de inventarios o expediciones y articulación con áreas internas/externas según el alcance declarado.');
  }
  if(/administracion|administrativ|finanzas|rrhh|recursos humanos|comercial/.test(n)){
    hints.push('Administración/Gestión: organización documental, seguimiento de procesos, coordinación interna, elaboración y control de información, atención de requerimientos y soporte a la toma de decisiones de acuerdo con el área declarada.');
  }
  if(/software|sistemas|it|programacion|datos|data/.test(n)){
    hints.push('IT/Software/Datos: análisis de requerimientos, organización de información, desarrollo o soporte de soluciones, documentación, pruebas, resolución de incidentes y mejora continua, usando sólo tecnologías efectivamente mencionadas.');
  }
  if(/soldadura|caldereria|montaje/.test(n)){
    hints.push('Soldadura/Montaje/Calderería: interpretación de planos, preparación y montaje de componentes, control dimensional y de terminación, coordinación segura de tareas y verificación de calidad, sólo cuando sea compatible con el oficio declarado.');
  }
  if(/construccion|obra|civil/.test(n)){
    hints.push('Construcción/Obra industrial: lectura de documentación técnica, seguimiento de obra, coordinación de frentes, control de avances, calidad, seguridad y resolución de interferencias según la función declarada.');
  }
  if(/planificacion|costos|planner/.test(n)){
    hints.push('Planificación/Costos: programación y seguimiento de actividades, control de avances, análisis de desvíos, coordinación de información, estimaciones y reportes de gestión, sin inventar herramientas o metodologías específicas.');
  }
  return hints;
}

function uniqProfessionalStrengths(items=[]){
  const out=[]; const seen=new Set();
  for(const item of items){
    const clean=String(item||'').replace(/\s+/g,' ').trim().replace(/[.;]+$/,'');
    if(!clean) continue;
    const key=professionalNorm(clean);
    if(!key || seen.has(key)) continue;
    seen.add(key); out.push(clean);
    if(out.length>=10) break;
  }
  return out;
}

function inferProfessionalStrengthsLocal(text='', context={}, seniority=''){
  // No completar con aptitudes típicas o adjetivos no declarados.
  return uniqProfessionalStrengths(String(text || '').split(/[\n.;]+/).map(x=>x.trim()).filter(x=>/\b(realizo|reparo|instalo|calibro|programo|gestiono|superviso|coordino|opero|atiendo)\b/i.test(x))).slice(0,10);
}

function buildProfessionalMotivationLocal(seniority='', context={}){
  const level=String(seniority||'').toUpperCase();
  const expertise=String(context?.expertise || '').trim();
  const area=expertise ? ` dentro de ${expertise}` : '';
  const working=!!context?.currentlyWorking;
  if(level==='SENIOR') return working
    ? `Busco nuevos desafíos donde pueda aportar la experiencia acumulada${area}, participar en proyectos de mayor alcance y, al mismo tiempo, seguir incorporando conocimientos y evolucionando profesionalmente junto con la organización.`
    : `Busco una oportunidad donde pueda poner al servicio de la empresa mi experiencia acumulada${area}, asumir desafíos de responsabilidad y continuar desarrollándome en proyectos que valoren el conocimiento técnico y la mejora continua.`;
  if(level==='SEMI_SENIOR') return `Busco una oportunidad que me permita consolidar mi experiencia${area}, asumir mayores responsabilidades, profundizar mis conocimientos y seguir creciendo dentro de un equipo y una organización con desafíos concretos.`;
  if(level==='JUNIOR') return `Busco una oportunidad para transformar mi formación y experiencia inicial${area} en mayor práctica profesional, aprender de equipos con experiencia, asumir responsabilidades progresivas y seguir creciendo dentro de la empresa.`;
  return `Busco una primera oportunidad para aprender, adquirir experiencia práctica${area}, demostrar compromiso con el trabajo y desarrollarme progresivamente dentro de una empresa que me permita capacitarme y crecer.`;
}

function buildProfessionalClosingLocal(seniority='', context={}){
  const level=String(seniority||'').toUpperCase();
  const expertise=String(context?.expertise || '').trim();
  const area=expertise ? ` en ${expertise}` : '';
  if(level==='SENIOR') return `Mi objetivo es combinar la experiencia adquirida con una actitud abierta a nuevas tecnologías, metodologías y formas de trabajo. Quiero seguir aportando criterio técnico${area}, acompañar el desarrollo de los equipos y contribuir a que los proyectos se ejecuten con calidad, seguridad y una mirada práctica orientada a resultados.`;
  if(level==='SEMI_SENIOR') return `Mi objetivo es seguir fortaleciendo mi autonomía profesional${area}, ampliar responsabilidades y aportar una mirada cada vez más integral. Me interesa continuar aprendiendo, trabajar de manera colaborativa y contribuir al cumplimiento de los objetivos del equipo.`;
  if(level==='JUNIOR') return `Mi objetivo es continuar construyendo una trayectoria sólida${area}, aprender de la experiencia cotidiana y convertir cada nuevo desafío en una oportunidad de crecimiento. Me interesa integrarme a un equipo donde pueda aportar, capacitarme y asumir responsabilidades en forma progresiva.`;
  return `Mi objetivo es comenzar a desarrollar una trayectoria laboral${area}, aprender haciendo y adquirir hábitos de trabajo sólidos. Quiero integrarme a un equipo donde pueda capacitarme, aportar compromiso y crecer paso a paso con nuevas responsabilidades.`;
}

function refineCandidatePresentationLocal(transcript='', context={}){
  const source=String(transcript || '').trim();
  const experience=String(context.resumeExperience || '').trim();
  const lines=[...new Set([source,experience].filter(Boolean))];
  const years=extractExplicitYearsFromText(experience || source);
  return {summary:lines.join('\n\n').slice(0,8000),yearsExperience:years,suggestedExperienceRange:experienceRangeFromYears(years),
    professionalTitle:'',expertise:'',seniority:'NO_DETERMINADO',strengths:inferProfessionalStrengthsLocal(source),motivation:'',closing:'',
    evidence:'Texto original conservado sin ampliar competencias no declaradas.',source:'LOCAL_V710_EVIDENCE_ONLY'};
}

function responseOutputText(payload={}){
  if(typeof payload.output_text === 'string') return payload.output_text;
  const texts=[];
  for(const item of payload.output || []){
    for(const content of item?.content || []){
      if(typeof content?.text === 'string') texts.push(content.text);
    }
  }
  return texts.join('\n').trim();
}

async function refineCandidatePresentationWithAI(transcript='', context={}){
  if(!OPENAI_API_KEY) return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),OPENAI_PRESENTATION_TIMEOUT_MS);
  try{
    const professionalContext={
      transcript:clampText(transcript,8000),
      current_or_recent_role:clampText(context?.recentRole || '',300),
      current_expertise:clampText(context?.expertise || '',180),
      cv_summary:clampText(context?.resumeSummary || '',1600),
      cv_experience:clampText(context?.resumeExperience || '',3600),
      cv_education:clampText(context?.resumeEducation || '',2400),
      cv_certifications:clampText(context?.resumeCertifications || '',2400),
      cv_observations:clampText(context?.resumeObservations || '',2200),
      declared_experience_range:clampText(context?.declaredRange || '',80),
      currently_working:!!context?.currentlyWorking,

    };
    const payload={
      model:OPENAI_MODEL,
      store:false,
      input:[
        { role:'system', content:[{type:'input_text',text:'Sos el asistente de redacción profesional de Talento PyME. Estás ayudando AL CANDIDATO A ESCRIBIR SU PROPIO CURRÍCULUM. Todo el contenido que irá al CV debe sonar como escrito por la propia persona, nunca como una opinión de Talento PyME. El campo summary debe quedar EN PRIMERA PERSONA: “Soy…”, “Cuento con…”, “Me especializo…”, “Desarrollo…”, “Superviso…”. Está prohibido redactar como evaluador externo: no usar “el candidato”, “su perfil”, “la experiencia declarada permite identificar”, “el relato evidencia”, “se observa”, “demuestra” ni fórmulas equivalentes. Fusioná el relato personal y, si existe, todo el CV ya leído por Talento PyME en UNA ÚNICA PRESENTACIÓN PROFESIONAL AMPLIADA, clara, convincente y fiel para la parte blanca principal del CV. El relato y el CV son fuentes complementarias: el CV aporta cargos, fechas, formación, certificaciones y antecedentes; la voz/texto aporta contexto, objetivos, fortalezas y detalles que quizá no estaban escritos. No pegues ni repitas las dos fuentes una detrás de otra: integrá, deduplicá y priorizá la información más concreta y reciente. Si hay una aparente contradicción, usá una redacción prudente y no inventes. No debe ser un resumen corto ni repetir la columna lateral. Cuando el material lo permita, desarrollala en 2 a 4 párrafos y aproximadamente 180 a 340 palabras. Traducí profesiones y funciones declaradas a vocabulario técnico propio del oficio para ayudar a la persona a nombrar tareas que realiza pero quizá no sabe expresar. No atribuyas tareas típicas del oficio ni capacidades que la persona no haya declarado. Si falta evidencia, omití la afirmación. Generá strengths con hasta 10 aptitudes/competencias expresamente respaldadas por el material, preferentemente técnicas y de gestión, coherentes con la profesión, expertise, seniority y experiencia disponible. Deben ser frases breves utilizables directamente como viñetas de un CV y no opiniones de un tercero. Generá motivation en primera persona explicando qué busca profesionalmente la persona y por qué desea crecer o seguir desarrollándose: para APRENDIZ/primer empleo enfatizar aprender y adquirir experiencia; para JUNIOR consolidar práctica y responsabilidades; para SEMI_SENIOR ampliar autonomía y alcance; para SENIOR aportar experiencia acumulada, asumir desafíos de mayor alcance, transferir conocimiento y seguir evolucionando. Si currently_working es true, no escribir como si estuviera desempleado: hablar de nuevos desafíos y evolución. Generá closing en primera persona como cierre profesional de 2 a 4 frases, integrando expertise, aporte y proyección. No inventes empleos, empresas, títulos, años, certificaciones, resultados, cantidades, marcas, software, normas, tensión, potencia, presupuestos ni tecnologías no mencionadas. Eliminá saludos, muletillas, repeticiones y “etcétera”. Si menciona años de experiencia, supervisión, proyectos, profesión o especialidades, dales el peso correspondiente. El seniority describe trayectoria, no calidad humana ni aptitud de contratación. Respondé únicamente con el JSON solicitado.'}] },
        { role:'user', content:[{type:'input_text',text:`Analizá nuevamente TODO el material profesional cada vez, no sólo lo agregado al final.\n\nDatos profesionales (sin identidad ni contacto):\n${JSON.stringify(professionalContext)}`}]}],
      text:{format:{type:'json_schema',name:'candidate_professional_presentation',strict:true,schema:{
        type:'object',additionalProperties:false,
        properties:{
          summary:{type:'string'},
          years_experience:{type:['integer','null'],minimum:0,maximum:65},
          seniority:{type:'string',enum:['APRENDIZ','JUNIOR','SEMI_SENIOR','SENIOR']},
          professional_title:{type:'string'},
          expertise:{type:'string'},
          strengths:{type:'array',items:{type:'string'},minItems:0,maxItems:10},
          motivation:{type:'string'},
          closing:{type:'string'},
          evidence:{type:'string'},
        },
        required:['summary','years_experience','seniority','professional_title','expertise','strengths','motivation','closing','evidence']
      }}}
    };
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      signal:controller.signal,
    });
    if(!response.ok){
      const body=await response.text().catch(()=> '');
      throw new Error(`OPENAI_${response.status}:${body.slice(0,240)}`);
    }
    const body=await response.json();
    const text=responseOutputText(body);
    const parsed=JSON.parse(text);
    const years=parsed.years_experience != null && Number.isFinite(Number(parsed.years_experience)) ? Number(parsed.years_experience) : extractExplicitYearsFromText([transcript,context?.resumeSummary,context?.resumeExperience].filter(Boolean).join('\n'));
    return {
      summary:clampText(parsed.summary || '',8000),
      yearsExperience:years,
      suggestedExperienceRange:experienceRangeFromYears(years),
      professionalTitle:clampText(parsed.professional_title || '',180),
      expertise:clampText(parsed.expertise || '',160),
      seniority:String(parsed.seniority || '').trim(),
      strengths:uniqProfessionalStrengths(Array.isArray(parsed.strengths) ? parsed.strengths : []).slice(0,10),
      motivation:clampText(parsed.motivation || '',1600),
      closing:clampText(parsed.closing || '',2400),
      evidence:clampText(parsed.evidence || '',500),
      source:'OPENAI',
    };
  }finally{
    clearTimeout(timer);
  }
}
app.post('/candidate/presentation/refine', auth, requireRole('CANDIDATE'), async (req, res) => {
  const parsed=candidatePresentationSchema.safeParse(req.body || {});
  if(!parsed.success) return res.status(400).json({ error:'Contanos un poco más para poder preparar tu presentación profesional.' });
  try{
    const candidate=await prisma.user.findUnique({
      where:{ id:req.user.id },
      include:{ candidateProfile:true, candidateBolsa:true, resume:true },
    });
    const classification=buildCandidateAdminClassification(candidate || {});
    const context={
      expertise:classification.expertiseLabel,
      recentRole:classification.recentRole,
      resumeSummary:candidate?.resume?.summary || '',
      resumeExperience:candidate?.resume?.experience || '',
      resumeEducation:candidate?.resume?.education || '',
      resumeCertifications:candidate?.resume?.certifications || '',
      resumeObservations:candidate?.resume?.observations || '',
      declaredRange:candidate?.candidateBolsa?.rangoExperiencia || '',
      currentlyWorking:!!candidate?.candidateBolsa?.trabajaActualmente,
    };
    let analysis=null;
    let aiError='';
    if(OPENAI_API_KEY){
      try{ analysis=await refineCandidatePresentationWithAI(parsed.data.transcript, context); }
      catch(err){ aiError=String(err?.message || err || '').slice(0,300); console.error('candidate presentation OpenAI fallback', aiError); }
    }
    if(!analysis) analysis=refineCandidatePresentationLocal(parsed.data.transcript, context);

    // v7.9.11: la corrección profesional se ejecuta únicamente a pedido explícito del candidato
    // y pasa a ser inmediatamente la presentación principal por defecto.
    const analyzedAt=new Date();
    const yearsExperience=analysis.yearsExperience != null && Number.isFinite(Number(analysis.yearsExperience)) ? Number(analysis.yearsExperience) : null;
    if(candidate?.candidateBolsa){
      const suggestedRange=String(analysis.suggestedExperienceRange || '').trim();
      const currentRange=String(candidate.candidateBolsa.rangoExperiencia || '').trim();
      await prisma.candidateBolsa.update({
        where:{ userId:req.user.id },
        data:{
          voiceNarrativeRaw:parsed.data.transcript,
          voiceNarrativeSummary:analysis.summary,
          voiceNarrativeAnalysisVersion:PRESENTATION_ANALYSIS_VERSION,
          voiceNarrativeAnalysisSource:analysis.source || 'LOCAL_V4_FIRST_PERSON_STRENGTHS',
          voiceNarrativeYears:yearsExperience,
          voiceNarrativeProfessionalTitle:clampText(analysis.professionalTitle || '',180) || null,
          voiceNarrativeStrengths:uniqProfessionalStrengths(analysis.strengths || []).slice(0,10),
          voiceNarrativeMotivation:clampText(analysis.motivation || '',1600) || null,
          voiceNarrativeClosing:clampText(analysis.closing || '',2400) || null,
          voiceNarrativeAnalyzedAt:analyzedAt,
          ...((suggestedRange && (!currentRange || currentRange==='Pendiente')) ? { rangoExperiencia:suggestedRange } : {}),
        }
      });
    }

    if(candidate?.candidateBolsa) queueCandidateClassification(req.user.id,'PRESENTATION_REFINED');
    return res.json({
      ok:true,
      persistedAsDefault:!!candidate?.candidateBolsa,
      summary:analysis.summary,
      analysis:{
        source:analysis.source,
        analysisVersion:PRESENTATION_ANALYSIS_VERSION,
        yearsExperience,
        suggestedExperienceRange:analysis.suggestedExperienceRange || '',
        seniority:analysis.seniority || '',
        professionalTitle:analysis.professionalTitle || '',
        expertise:analysis.expertise || '',
        strengths:uniqProfessionalStrengths(analysis.strengths || []).slice(0,10),
        motivation:analysis.motivation || '',
        closing:analysis.closing || '',
        evidence:analysis.evidence || '',
        aiConfigured:!!OPENAI_API_KEY,
        fallbackUsed:analysis.source !== 'OPENAI',
        ...(aiError ? { diagnostic:'La IA generativa no respondió y se utilizó el analizador local de respaldo.' } : {}),
      }
    });
  }catch(err){
    console.error('POST /candidate/presentation/refine', err);
    return res.status(500).json({ error:'No se pudo preparar la presentación en este momento.' });
  }
});

app.get('/candidate/cv/pdf', auth, requireRole('CANDIDATE'), async (req, res) => {
  try{
    const candidate=await prisma.user.findUnique({
      where:{ id:req.user.id },
      select:{
        id:true,email:true,createdAt:true,
        candidateProfile:{ select:{ fullName:true,dni:true,city:true,province:true,country:true,phone:true,address:true,headline:true,sector:true,subSector:true } },
        candidateBolsa:true,
        resume:true,
      },
    });
    if(!candidate) return res.status(404).json({ error:'Candidato no encontrado.' });
    // La clasificación es un enriquecimiento del CV, nunca una condición para poder descargarlo.
    // Si un registro histórico tiene algún dato atípico, generamos igualmente el PDF con la información disponible.
    let classification={};
    try{ classification=buildCandidateAdminClassification(candidate) || {}; }
    catch(classificationError){ console.warn('candidate cv classification fallback', req.user.id, classificationError?.message || classificationError); }
    const pdf=await buildCandidateCvPdfBuffer({ user:{id:candidate.id,email:candidate.email}, profile:candidate.candidateProfile, bolsa:candidate.candidateBolsa, resume:candidate.resume, classification });
    if(!Buffer.isBuffer(pdf) || pdf.length<100) throw new Error('El generador devolvió un PDF vacío.');
    const filename=buildCandidateCvFilename({ profile:candidate.candidateProfile, bolsa:candidate.candidateBolsa }, new Date());
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${filename.replace(/"/g,'')}"`);
    res.setHeader('Content-Length',String(pdf.length));
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('Pragma','no-cache');
    return res.send(pdf);
  }catch(err){
    console.error('GET /candidate/cv/pdf', err);
    return res.status(500).json({ error:'No se pudo generar el currículum PDF.' });
  }
});

app.get('/candidate/cv/sample.pdf', auth, requireRole('CANDIDATE'), async (req, res) => {
  try{
    const pdf=await buildCandidateCvPdfBuffer(buildCandidateSampleCvData());
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','inline; filename="CV-Tipo-Talento-PyME.pdf"');
    res.setHeader('Cache-Control','no-store');
    return res.send(pdf);
  }catch(err){
    console.error('GET /candidate/cv/sample.pdf', err);
    return res.status(500).json({ error:'No se pudo generar el currículum tipo.' });
  }
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
  website: z.string().max(200).optional().nullable(),
  companySummary: z.string().max(2400).optional().nullable(),
  showCompanySummary: z.boolean().optional().nullable(),
  candidateBookmarks: z.array(z.string()).optional().nullable()
});

// ============================
// Bolsa de Trabajo (perfil laboral UIC-style)
// ============================

app.get("/bolsa/me", authRequired, requireRole("CANDIDATE"), async (req, res) => {
  try{
    let bolsa = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id } });
    if(bolsa){
      const profile = await prisma.profile.findUnique({ where:{ userId:req.user.id }, select:{ city:true, province:true, country:true } }).catch(()=>null);
      const residence=inferResidence({ locality:bolsa.localidad || profile?.city, province:bolsa.provinciaResidencia || profile?.province, country:bolsa.paisResidencia || profile?.country });
      const patch={};
      if(residence.city && residence.city !== bolsa.localidad) patch.localidad=residence.city;
      if(residence.province && residence.province !== bolsa.provinciaResidencia) patch.provinciaResidencia=residence.province;
      if(residence.country && residence.country !== bolsa.paisResidencia) patch.paisResidencia=residence.country;
      if(Object.keys(patch).length){
        bolsa=await prisma.candidateBolsa.update({ where:{ userId:req.user.id }, data:patch }).catch(()=>({ ...bolsa, ...patch }));
        if(residence.province || residence.city){
          await prisma.profile.update({ where:{ userId:req.user.id }, data:{ ...(residence.city?{city:residence.city}:{}), ...(residence.province?{province:residence.province}:{}), ...(residence.country?{country:residence.country}:{}) } }).catch(()=>null);
        }
      }
    }
    return res.json({ ok: true, bolsa });
  }catch(err){
    console.error("GET /bolsa/me", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.post("/bolsa/me", authRequired, requireRole("CANDIDATE"), async (req, res) => {
  try{
    if(req.user.role !== "CANDIDATE"){
      return res.status(403).json({ ok:false, error:"FORBIDDEN_ROLE" });
    }
    const data = bolsaSchema.parse(req.body);
    if(data.observaciones) data.observaciones = clampText(data.observaciones, 12000);

    const existingProfile = await prisma.profile.findUnique({ where: { userId: req.user.id } });
    const residence=inferResidence({ locality:data.localidad || existingProfile?.city, province:data.provinciaResidencia || existingProfile?.province, country:data.paisResidencia || existingProfile?.country });
    if(residence.city) data.localidad=residence.city;
    if(residence.province) data.provinciaResidencia=residence.province;
    if(residence.country) data.paisResidencia=residence.country;
    if(existingProfile?.dni && String(existingProfile.dni) !== String(data.dni)){
      return res.status(400).json({ ok:false, error:"DNI_MISMATCH_WITH_PROFILE" });
    }

    // Keep profile basics in sync (best-effort)
    await prisma.profile.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        fullName: `${data.nombre} ${data.apellido}`.trim(),
        fullNameNorm: normalizeName(`${data.nombre} ${data.apellido}`.trim()),
        dni: data.dni,
        city: data.localidad,
        province: data.provinciaResidencia || existingProfile?.province || null,
        country: data.paisResidencia || existingProfile?.country || null,
        address: data.direccion || "",
        phone: data.telefono,
      },
      update: {
        fullName: `${data.nombre} ${data.apellido}`.trim(),
        fullNameNorm: normalizeName(`${data.nombre} ${data.apellido}`.trim()),
        dni: data.dni,
        city: data.localidad,
        province: data.provinciaResidencia || existingProfile?.province || null,
        country: data.paisResidencia || existingProfile?.country || null,
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

    queueCandidateClassification(req.user.id,'BOLSA_UPDATED');
    return res.json({ ok:true, bolsa: saved });
  }catch(err){
    if(err?.name === "ZodError"){
      return res.status(400).json({ ok:false, error:"VALIDATION", details: err.errors });
    }
    console.error("POST /bolsa/me", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.post("/bolsa/photo", authRequired, requireRole("CANDIDATE"), upload.single("photo"), async (req, res) => {
  try{
    if(req.user.role !== "CANDIDATE"){
      return res.status(403).json({ ok:false, error:"FORBIDDEN_ROLE" });
    }
    const file = req.file;
    if(!file){
      return res.status(400).json({ ok:false, error:"PHOTO_REQUIRED" });
    }
    const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
    const mime = String(file.mimetype || "").toLowerCase();
    if(!allowed.has(mime)){
      return res.status(400).json({ ok:false, error:"PHOTO_TYPE_NOT_ALLOWED" });
    }
    const photoDataUrl = `data:${mime};base64,${file.buffer.toString("base64")}`;
    const existing = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id } });
    const prof = existing ? null : await prisma.profile.findUnique({ where: { userId: req.user.id } });
    const fullName = String(prof?.fullName || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const nombreBase = existing?.nombre || parts.slice(0, 1).join(" ") || "Pendiente";
    const apellidoBase = existing?.apellido || parts.slice(1).join(" ") || "Pendiente";
    const saved = await prisma.candidateBolsa.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        nombre: nombreBase,
        apellido: apellidoBase,
        dni: existing?.dni || prof?.dni || "PENDIENTE",
        nacionalidad: existing?.nacionalidad || "Argentina",
        estadoCivil: existing?.estadoCivil || "Prefiero no decir",
        hijos: existing?.hijos || "0",
        telefono: existing?.telefono || prof?.phone || "Pendiente",
        correo: existing?.correo || req.user.email || "pendiente@example.com",
        localidad: existing?.localidad || prof?.city || "Pendiente",
        areaTrabajo: existing?.areaTrabajo || "Pendiente",
        especialidad: existing?.especialidad || "Pendiente",
        rangoExperiencia: existing?.rangoExperiencia || "Pendiente",
        nivelEducativo: existing?.nivelEducativo || "Pendiente",
        tieneCapacitacion: existing?.tieneCapacitacion || false,
        trabajaActualmente: existing?.trabajaActualmente || false,
        photoDataUrl
      },
      update: { photoDataUrl }
    });
    return res.json({ ok:true, photoDataUrl: saved.photoDataUrl || photoDataUrl });
  }catch(err){
    console.error("POST /bolsa/photo", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.delete("/bolsa/photo", authRequired, requireRole("CANDIDATE"), async (req, res) => {
  try{
    if(req.user.role !== "CANDIDATE"){
      return res.status(403).json({ ok:false, error:"FORBIDDEN_ROLE" });
    }
    const existing = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id } });
    if(!existing){
      return res.json({ ok:true, photoDataUrl: "" });
    }
    const saved = await prisma.candidateBolsa.update({
      where: { userId: req.user.id },
      data: { photoDataUrl: null }
    });
    return res.json({ ok:true, photoDataUrl: saved.photoDataUrl || "" });
  }catch(err){
    console.error("DELETE /bolsa/photo", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.get("/bolsa/stats", authRequired, requireAnyRole(["ADMIN","SUPERADMIN"]), async (req, res) => {
  try{
    const total = await prisma.candidateBolsa.count();
    return res.json({ ok:true, total });
  }catch(err){
    console.error("GET /bolsa/stats", err);
    return res.status(500).json({ ok:false, error:"SERVER_ERROR" });
  }
});

app.get("/bolsa/search", authRequired, (_req, res) => res.status(410).json({
  ok:false,
  error:"LEGACY_SEARCH_DISABLED",
  message:"Este buscador legado fue retirado por privacidad. Las empresas deben usar Buscar Talento.",
}));

function _registeredSinceDate(code) {
  const now = Date.now();
  switch (String(code || '').toLowerCase()) {
    case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case '30d':
    case '1m': return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case '90d':
    case '3m': return new Date(now - 90 * 24 * 60 * 60 * 1000);
    case '365d':
    case '12m':
    case '1y': return new Date(now - 365 * 24 * 60 * 60 * 1000);
    default: return null;
  }
}

function _candidateFreshMs(it) {
  const dt = it?.updatedAt || it?.createdAt;
  return dt ? new Date(dt).getTime() : 0;
}

function localityMatches(candidateValue, filterValue) {
  const a = String(candidateValue || '').trim().toLowerCase();
  const b = String(filterValue || '').trim().toLowerCase();
  if (!b) return true;
  return a === b || a.startsWith(b);
}

function toArrayField(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map((x) => x.trim()).filter(Boolean);
}

function facetStats(items) {
  const facets = { area: {}, localidad: {}, nivel: {}, rango_experiencia: {}, nivel_educativo: {} };
  const especialidad_by_area = {};
  for (const it of items || []) {
    const area = String(it.areaTrabajo || '').trim();
    const localidad = String(it.localidadNormalizada || it.localidad || '').trim();
    const nivel = String(it.nivel || '').trim();
    const exp = String(it.rangoExperiencia || '').trim();
    const edu = String(it.nivelEducativo || '').trim();
    const esp = String(it.especialidad === 'Otros' ? (it.especialidadOtro || 'Otros') : (it.especialidad || '')).trim();
    if (area) facets.area[area] = (facets.area[area] || 0) + 1;
    if (localidad) facets.localidad[localidad] = (facets.localidad[localidad] || 0) + 1;
    if (nivel) facets.nivel[nivel] = (facets.nivel[nivel] || 0) + 1;
    if (exp) facets.rango_experiencia[exp] = (facets.rango_experiencia[exp] || 0) + 1;
    if (edu) facets.nivel_educativo[edu] = (facets.nivel_educativo[edu] || 0) + 1;
    if (area && esp) {
      especialidad_by_area[area] = especialidad_by_area[area] || {};
      especialidad_by_area[area][esp] = (especialidad_by_area[area][esp] || 0) + 1;
    }
  }
  return { facets, especialidad_by_area };
}

app.get('/jobs/stats', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const items = await prisma.candidateBolsa.findMany({
      where:{ user:{ hiddenFromSearch:false } },
      include:{ user:{select:{resume:true,candidateProfile:true,hiddenFromSearch:true}} },
      orderBy: { updatedAt: 'desc' },
    });
    const classified=items.map(it=>{
      const candidate={candidateBolsa:it,resume:it.user?.resume,candidateProfile:it.user?.candidateProfile};
      const c=buildCandidateAdminClassification(candidate);
      const residence=candidateResidence(candidate);
      return {...it,localidadNormalizada:residence.city,areaTrabajo:c.expertiseLabel,especialidad:c.profileTitle,nivel:c.classLabel};
    });
    const rawStats = facetStats(classified);
    const facets = Object.fromEntries(
      Object.entries(rawStats.facets || {}).map(([key, values]) => [key, Object.keys(values || {})])
    );
    const especialidad_by_area = Object.fromEntries(
      Object.entries(rawStats.especialidad_by_area || {}).map(([area, values]) => [area, Object.keys(values || {})])
    );
    // v7.9.11: la vista empresa recibe disponibilidad de filtros, pero no cantidades globales
    // ni conteos por faceta. Los totales de padrón quedan reservados al Panel General.
    return res.json({ ok: true, facets, especialidad_by_area });
  } catch (err) {
    console.error('GET /jobs/stats', err);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

app.get('/jobs/search', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const area = String(req.query.area || '').trim();
    const localidad = String(req.query.localidad || '').trim();
    const nivel = String(req.query.nivel || '').trim();
    const especialidad = String(req.query.especialidad || '').trim();
    const rangoExperiencia = String(req.query.rango_experiencia || '').trim();
    const nivelEducativo = String(req.query.nivel_educativo || '').trim();
    const tieneCapacitacion = String(req.query.tiene_capacitacion || '').trim();
    const trabajaActualmente = String(req.query.trabaja_actualmente || '').trim();
    const soldadorCategoria = String(req.query.soldador_categoria || '').trim();
    const herramienta = String(req.query.herramienta || '').trim();
    const instrumento = String(req.query.instrumento || '').trim();
    const ultimaActualizacion = String(req.query.ultima_actualizacion || '').trim();
    const orden = String(req.query.orden || 'recientes').trim();

    const all = await prisma.candidateBolsa.findMany({
      where:{ user:{ hiddenFromSearch:false } },
      select: {
        id:true, nombre:true, apellido:true, dni:true, nacionalidad:true, estadoCivil:true, hijos:true,
        telefono:true, telefonoAdicional:true, fechaNacimiento:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, voiceNarrativeRaw:true, voiceNarrativeSummary:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true,
        user: { select: { candidateProfile:true, resume:true, hiddenFromSearch:true } }
      },

    });

    const classified=all.map(it=>{
      const candidate={candidateBolsa:it,resume:it.user?.resume,candidateProfile:it.user?.candidateProfile};
      const residence=candidateResidence(candidate);
      return {...it,localidadNormalizada:residence.city,classification:buildCandidateAdminClassification(candidate),candidate};
    });
    const sinceDate = _registeredSinceDate(ultimaActualizacion);
    const filtered = classified.filter((it) => {
      const c=it.classification;
      if(q && !adminSearchTextMatch(`${candidateProfessionalSearchText(it.candidate,c)} ${it.localidadNormalizada || ''}`,q)) return false;
      if(area && c.expertiseLabel !== area) return false;
      if(localidad && !localityMatches(it.localidadNormalizada || it.localidad,localidad)) return false;
      if(nivel && c.classLabel !== nivel) return false;
      if(especialidad && c.profileTitle !== especialidad) return false;
      if (rangoExperiencia && String(it.rangoExperiencia || '') !== rangoExperiencia) return false;
      if (nivelEducativo && String(it.nivelEducativo || '') !== nivelEducativo) return false;
      if (tieneCapacitacion === 'SI' && !it.tieneCapacitacion) return false;
      if (tieneCapacitacion === 'NO' && !!it.tieneCapacitacion) return false;
      if (trabajaActualmente === 'SI' && !it.trabajaActualmente) return false;
      if (trabajaActualmente === 'NO' && !!it.trabajaActualmente) return false;
      if (soldadorCategoria && String(it.soldadorCategoria || '') !== soldadorCategoria) return false;
      if (herramienta && !toArrayField(it.herramientasMecanica).includes(herramienta)) return false;
      if (instrumento && !toArrayField(it.instrumentosElectrica).includes(instrumento)) return false;
      if (sinceDate && _candidateFreshMs(it) < sinceDate.getTime()) return false;
      return true;
    }).sort((a, b) => {
      const diff = _candidateFreshMs(b) - _candidateFreshMs(a);
      return orden === 'antiguos' ? -diff : diff;
    }).slice(0, 200).map((it) => ({
      id: it.id,
      perfil_propuesto: it.classification.profileTitle,
      nivel_propuesto: it.classification.seniorityLabel,
      nombre: it.nombre,
      apellido: it.apellido,
      localidad: it.localidadNormalizada || it.localidad,
      area_trabajo: it.classification.expertiseLabel,
      nivel: it.classification.classLabel,
      especialidad: it.classification.profileTitle,
      especialidad_otro: it.especialidadOtro,
      soldador_categoria: it.soldadorCategoria || null,
      rango_experiencia: it.rangoExperiencia,
      nivel_educativo: it.nivelEducativo,
      tiene_capacitacion: it.tieneCapacitacion,
      trabaja_actualmente: it.trabajaActualmente,
      sueldo_pretendido: it.sueldoPretendido,
      ultimo_trabajo: '',
      observaciones: '',
      presentacion_profesional: '',
      resume_summary: '',
      photoDataUrl: it.photoDataUrl,
      herramientas_mecanica: toArrayField(it.herramientasMecanica),
      instrumentos_electrica: toArrayField(it.instrumentosElectrica),
      created_at: it.createdAt,
      updated_at: it.updatedAt,
      access_locked: true,
    }));

    const { company } = await getCompanyContextByUserId(req.user.id);
    const openingUsage = await getCompanyOperationUsage(company.id);
    return res.json({ ok: true, items: filtered, openingUsage });
  } catch (err) {
    console.error('GET /jobs/search', err);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

app.get('/jobs/candidate/:id/detail', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const candidateId = String(req.params.id || '').trim();
    if(!candidateId) return res.status(400).json({ error: 'Falta candidateId' });
    const { company } = await getCompanyContextByUserId(req.user.id);
    const it = await prisma.candidateBolsa.findUnique({
      where: { id: candidateId },
      select: {
        id:true, nombre:true, apellido:true, dni:true, nacionalidad:true, estadoCivil:true, hijos:true,
        telefono:true, telefonoAdicional:true, fechaNacimiento:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, voiceNarrativeRaw:true, voiceNarrativeSummary:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true, user:{select:{resume:true,candidateProfile:true,hiddenFromSearch:true}}
      }
    });
    if(!it || it.user?.hiddenFromSearch) return res.status(404).json({ error: 'Candidato no encontrado' });
    const accessResult = await ensureCompanyCandidateAccess(company.id, candidateId);
    if(!accessResult.ok){
      return res.status(402).json({ error: accessResult.error, openingUsage: accessResult.usage || null });
    }
    const candidate={candidateBolsa:it,resume:it.user?.resume,candidateProfile:it.user?.candidateProfile};
    const classification=buildCandidateAdminClassification(candidate);
    const quickFacts=candidateQuickFacts(candidate);
    return res.json({
      ok: true,
      consumed: accessResult.consumed,
      openingUsage: accessResult.usage,
      item: {
        id: it.id,
        quickFacts,
        perfil_propuesto: classification.profileTitle,
        evaluacion_profesional: classification.assessment,
        nivel_propuesto: classification.seniorityLabel,
        lectura_profesional: {
          perfil: classification.profileTitle || '',
          nivel: classification.seniorityLabel || 'Nivel por verificar',
          experiencia_relevante_anios: classification.relevantYearsExperience ?? null,
          ultimo_rol_detectado: classification.recentRole || it.ultimoTrabajo || '',
          fundamento: classification.reason || '',
          evidencias: Array.isArray(classification.evidence) ? classification.evidence.slice(0,5) : [],
          informacion_a_confirmar: Array.isArray(classification.gaps) ? classification.gaps.slice(0,5) : [],
          fuentes_profesionales: Array.isArray(classification.professionalSourcesUsed) ? classification.professionalSourcesUsed.slice(0,6) : [],
        },
        nombre: it.nombre,
        apellido: it.apellido,
        dni: it.dni,
        nacionalidad: it.nacionalidad,
        estado_civil: it.estadoCivil,
        hijos: it.hijos,
        telefono: it.telefono,
        correo: it.correo,
        localidad: it.localidad,
        direccion: it.direccion,
        area_trabajo: it.areaTrabajo,
        nivel: it.nivel,
        especialidad: it.especialidad,
        especialidad_otro: it.especialidadOtro,
        rango_experiencia: it.rangoExperiencia,
        nivel_educativo: it.nivelEducativo,
        tiene_capacitacion: it.tieneCapacitacion,
        trabaja_actualmente: it.trabajaActualmente,
        sueldo_pretendido: it.sueldoPretendido,
        ultimo_trabajo: it.ultimoTrabajo,
        observaciones: it.observaciones,
        presentacion_profesional: it.voiceNarrativeSummary || '',
        photoDataUrl: it.photoDataUrl,
        herramientas_mecanica: toArrayField(it.herramientasMecanica),
        instrumentos_electrica: toArrayField(it.instrumentosElectrica),
        created_at: it.createdAt,
        updated_at: it.updatedAt,
      }
    });
  } catch (err) {
    console.error('GET /jobs/candidate/:id/detail', err);
    return res.status(500).json({ error: err?.message || 'No se pudo abrir el detalle del candidato' });
  }
});





function isPrivateNetworkAddress(address = "") {
  const a = String(address || "").toLowerCase();
  if(!a) return true;
  if(net.isIP(a) === 4){
    const parts = a.split('.').map(Number);
    const [x,y] = parts;
    return x === 0 || x === 10 || x === 127 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 198 && (y === 18 || y === 19)) ||
      x >= 224;
  }
  if(net.isIP(a) === 6){
    if(a === '::1' || a === '::') return true;
    if(a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
    if(a.startsWith('::ffff:')) return isPrivateNetworkAddress(a.slice(7));
  }
  return false;
}

async function assertPublicWebsiteUrl(rawUrl){
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('WEBSITE_URL_INVALID'); }
  if(!['http:','https:'].includes(parsed.protocol)) throw new Error('WEBSITE_URL_INVALID');
  const hostname = parsed.hostname.toLowerCase();
  if(!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('WEBSITE_URL_BLOCKED');
  if(net.isIP(hostname)){
    if(isPrivateNetworkAddress(hostname)) throw new Error('WEBSITE_URL_BLOCKED');
  }else{
    const resolved = await dns.lookup(hostname, { all:true, verbatim:true }).catch(() => []);
    if(!resolved.length) throw new Error('WEBSITE_DNS_FAILED');
    if(resolved.some((row) => isPrivateNetworkAddress(row.address))) throw new Error('WEBSITE_URL_BLOCKED');
  }
  return parsed;
}

async function readTextLimited(response, limitBytes = 2 * 1024 * 1024){
  const declared = Number(response.headers.get('content-length') || 0);
  if(declared > limitBytes) throw new Error('WEBSITE_TOO_LARGE');
  if(!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    size += value?.byteLength || 0;
    if(size > limitBytes){ try { await reader.cancel(); } catch {} throw new Error('WEBSITE_TOO_LARGE'); }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for(const chunk of chunks){ merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal:false }).decode(merged);
}

async function fetchPublicWebsite(rawUrl){
  let current = (await assertPublicWebsiteUrl(rawUrl)).toString();
  for(let redirects = 0; redirects <= 3; redirects += 1){
    const response = await fetch(current, {
      redirect:'manual',
      signal: AbortSignal.timeout(10000),
      headers:{ 'User-Agent':'TalentoPyME/7.10.3 (+Render)' },
    });
    if(response.status >= 300 && response.status < 400){
      const location = response.headers.get('location');
      if(!location) throw new Error('WEBSITE_REDIRECT_INVALID');
      current = (await assertPublicWebsiteUrl(new URL(location, current).toString())).toString();
      continue;
    }
    if(!response.ok) throw new Error(`WEBSITE_HTTP_${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if(contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error('WEBSITE_CONTENT_TYPE');
    return { response, finalUrl:current };
  }
  throw new Error('WEBSITE_TOO_MANY_REDIRECTS');
}

function stripHtml(raw) {
  return String(raw || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function inferCompanyKind(text) {
  const t = String(text || '').toLowerCase();
  const scores = [
    ['servicios', /(servicio|mantenimiento|consultor|outsourcing|ingenier[ií]a|soporte|provisi[oó]n de servicios)/g],
    ['fabricación', /(f[aá]brica|manufactura|producci[oó]n|planta|industrial|conversi[oó]n|proceso)/g],
    ['logística', /(log[ií]stica|almac[eé]n|dep[oó]sito|transporte|supply chain|distribuci[oó]n)/g],
  ].map(([name, re]) => [name, (t.match(re) || []).length]);
  scores.sort((a,b)=>b[1]-a[1]);
  return scores[0][1] ? scores[0][0] : 'industrial';
}
function summarizeCompanySite({ title, description, bodyText, url }) {
  const source = [title, description, bodyText].filter(Boolean).join(' · ');
  const kind = inferCompanyKind(source);
  const cleanTitle = String(title || '')
    .replace(/\s*[-|–].*$/, '')
    .replace(/(inicio|home)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const navWords = new Set(['inicio','home','servicios','service','navegacion','navigation','contacto','contact','clientes','portfolio','portafolio','blog','idioma','espanol','español','english','portugues','português','menu','staff']);
  const rawText = String(bodyText || '').replace(/\s+/g, ' ').trim();
  const fragments = rawText
    .split(/(?<=[\.!?])\s+|\s+[·|]\s+|\s{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((part) => part.length >= 50 && part.length <= 240)
    .filter((part) => {
      const words = normalizeName(part).split(' ').filter(Boolean);
      if(words.length < 8) return false;
      const navHits = words.filter((w) => navWords.has(w)).length;
      return navHits <= Math.max(1, Math.floor(words.length * 0.18));
    });
  const narrativeParts = [];
  const cleanedDescription = String(description || '')
    .replace(/(inicio|home|navigation|navegacion|menu)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanedDescription) narrativeParts.push(cleanedDescription);
  const seen = new Set(narrativeParts.map((part) => normalizeName(part)));
  for (const part of fragments) {
    const cleaned = part
      .replace(/(inicio|home|navigation|navegacion|menu|blog|portfolio|portafolio|contacto|contact)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = normalizeName(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    narrativeParts.push(cleaned);
    if (narrativeParts.length >= 4) break;
  }
  let narrative = narrativeParts.join(' ');
  if (!narrative && rawText) narrative = rawText.slice(0, 520);
  narrative = narrative
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
    .slice(0, 760);
  const lead = cleanTitle
    ? `${cleanTitle} se presenta como una empresa del ámbito ${kind}, orientada a servicios, soluciones técnicas y respuesta operativa para la industria y actividades vinculadas.`
    : `La empresa se presenta dentro del ámbito ${kind}, con foco en capacidad técnica, servicios y acompañamiento operativo.`;
  const summary = `${lead}${narrative ? ' ' + narrative : ''}`
    .replace(/(inicio|home|navigation|navegacion|menu)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { summary, kind, sourceUrl: url || null };
}

app.post('/company/analyze-site', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const website = String(req.body?.website || '').trim();
    if (!website) return res.status(400).json({ error: 'Falta sitio web' });
    let url = website;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const { response, finalUrl } = await fetchPublicWebsite(url);
    url = finalUrl;
    const html = await readTextLimited(response);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1].replace(/\s+/g,' ').trim();
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) || [,''])[1].trim();
    const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i) || [,''])[1].trim();
    const bodyText = stripHtml(html).slice(0, 2400);
    const data = summarizeCompanySite({ title, description: metaDesc || ogDesc, bodyText, url });
    res.json({ ok: true, ...data });
  } catch (err) {
    const code = String(err?.message || '');
    if(['WEBSITE_URL_INVALID','WEBSITE_URL_BLOCKED','WEBSITE_DNS_FAILED','WEBSITE_TOO_LARGE','WEBSITE_CONTENT_TYPE','WEBSITE_REDIRECT_INVALID','WEBSITE_TOO_MANY_REDIRECTS'].includes(code)){
      return res.status(400).json({ error: 'No pudimos analizar esa dirección web. Ingresá un sitio público válido de la empresa.' });
    }
    console.error('POST /company/analyze-site', err);
    res.status(500).json({ error: 'No se pudo analizar el sitio web' });
  }
});

app.get("/company/me", auth, requireRole("COMPANY"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { company: true } });
  const c = user?.company || null;
  if (!c) return res.json(null);
  res.json({
    ...c,
    contactEmail: c.contactEmail || user?.email || null,
  });
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

app.get('/factory/bootstrap', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  try {
    const { company, user } = await getCompanyContextByUserId(req.user.id);
    await expireStalePendingOrders(company.id);
    const now = new Date();
    const orders = await prisma.billingOrder.findMany({
      where: { companyId: company.id },
      include: { company: true, items: true },
      orderBy: { createdAt: 'desc' }
    }).catch(() => []);
    const visibleOrders = orders.filter((order) => companyVisibleOrder(order, now));
    const recentOrders = visibleOrders.map(orderToSummary).sort((a, b) => new Date(a.dueDate || a.date || 0).getTime() - new Date(b.dueDate || b.date || 0).getTime() || new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
    const totals = recentOrders.reduce((acc, it) => {
      acc.total += it.totals.total;
      acc.pending += it.status === 'PENDING_PAYMENT' ? it.totals.total : 0;
      acc.paid += it.status === 'PAID' ? it.totals.total : 0;
      acc.orders += 1;
      return acc;
    }, { total: 0, pending: 0, paid: 0, orders: 0 });
    const operationUsage = await getCompanyOperationUsage(company.id);
    const plans = await getFactoryPlans(true);
    const coupons = await prisma.factoryCoupon.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []);
    const activeFreeTicket = await findBlockingFreeTicket(company.id).catch(() => null);
    const adminVisible = factoryAdminCompanyMatches(company);
    res.json({
      ok: true,
      role: req.user.role,
      adminUnlocked: adminVisible && isFactoryAdminCredentialsAuthorized(req),
      company: {
        id: company.id,
        companyName: company.companyName,
        cuit: company.cuit,
        address: company.address,
        city: company.city,
        province: company.province,
        contactEmail: company.contactEmail || user?.email || null,
        contactName: company.contactName || null,
        phone: company.phone || null,
        companyCode: companyCodeFrom(company),
      },
      supportEmail: FACTORY_SUPPORT_EMAIL,
      factoryAdmin: {
        aliasHint: adminVisible ? (FACTORY_ADMIN_ALIAS || '') : '',
        configured: !!((FACTORY_ADMIN_ALIAS && FACTORY_ADMIN_PASSWORD) || FACTORY_SUPERADMIN_KEY),
        visible: adminVisible,
        visibilityMessage: factoryAdminVisibilityMessage(company),
        allowedCompanies: FACTORY_ADMIN_ALLOWED_COMPANIES,
      },
      plans,
      orders: recentOrders,
      totals,
      operationUsage,
      openingUsage: operationUsage,
      activeFreeTicket: activeFreeTicket ? {
        orderId: activeFreeTicket.order.id,
        ticketNo: activeFreeTicket.ticketNo,
        expiresAt: activeFreeTicket.expiresAt,
        remainingPublications: activeFreeTicket.remainingPublications,
        remainingSearches: activeFreeTicket.remainingSearches,
        pendingValidation: !!activeFreeTicket.pendingValidation,
      } : null,
      couponCatalog: coupons.map((row)=> ({ code: row.code, discountPct: row.discountPct, companyId: row.companyId || null, grantsFullAccess: !!row.grantsFullAccess, fullAccessUntil: row.fullAccessUntil || null })),
    });
  } catch (err) {
    console.error('GET /factory/bootstrap', err);
    res.status(500).json({ error: 'No se pudo cargar Factory' });
  }
});

app.post('/factory/redeem-access-code', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  try {
    const { company } = await getCompanyContextByUserId(req.user.id);
    const code = String(req.body?.code || '').trim().toUpperCase();
    if(!code) return res.status(400).json({ error: 'Ingresá un código válido.' });
    const coupon = await prisma.factoryCoupon.findUnique({ where: { code } }).catch(() => null);
    if(!coupon || !coupon.isActive || !coupon.grantsFullAccess || !coupon.fullAccessUntil) return res.status(404).json({ error: 'El código ingresado no habilita acceso total.' });
    if(coupon.companyId && coupon.companyId !== company.id) return res.status(403).json({ error: 'Este código fue emitido para otra empresa.' });
    if(new Date(coupon.fullAccessUntil) <= new Date()) return res.status(400).json({ error: 'Este código ya está vencido.' });
    await prisma.companyFactoryGrant.upsert({
      where: { companyId_code: { companyId: company.id, code } },
      update: { fullAccessUntil: coupon.fullAccessUntil },
      create: { companyId: company.id, code, fullAccessUntil: coupon.fullAccessUntil }
    });
    await prisma.factoryCoupon.update({ where: { code }, data: { isActive: false } }).catch(() => null);
    const operationUsage = await getCompanyOperationUsage(company.id);
    res.json({ ok: true, message: `Acceso total habilitado hasta ${new Date(coupon.fullAccessUntil).toLocaleDateString('es-AR')}.`, operationUsage });
  } catch (err) {
    console.error('POST /factory/redeem-access-code', err);
    res.status(500).json({ error: 'No se pudo activar el acceso especial.' });
  }
});

app.post('/factory/quote', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  try {
    const { company } = await getCompanyContextByUserId(req.user.id);
    const quote = await buildFactoryQuote(company.id, req.body?.items || [], req.body?.couponCode || '');
    res.json({ ok: true, ...quote });
  } catch (err) {
    console.error('POST /factory/quote', err);
    res.status(500).json({ error: 'No se pudo calcular el presupuesto' });
  }
});

app.get('/factory/orders/:orderId/status', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  try {
    const { company } = await getCompanyContextByUserId(req.user.id);
    await expireStalePendingOrders(company.id);
    const orderId = String(req.params?.orderId || '').trim();
    if(!orderId) return res.status(400).json({ error: 'Falta la orden.' });
    const order = await prisma.billingOrder.findFirst({ where: { id: orderId, companyId: company.id }, include: { company: true, items: true } }).catch(() => null);
    if(!order) return res.status(404).json({ error: 'Orden no encontrada.' });
    return res.json({ ok: true, order: orderToSummary(order) });
  } catch (err) {
    console.error('GET /factory/orders/:orderId/status', err);
    return res.status(500).json({ error: 'No se pudo consultar el estado del pedido.' });
  }
});

app.post('/factory/checkout', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  let order = null;
  try {
    const { company, user } = await getCompanyContextByUserId(req.user.id);
    const actor = minimalActorMeta(user, company);
    await expireStalePendingOrders(company.id);
    const forbiddenFields = listForbiddenPaymentFields(req.body || {});
    if(forbiddenFields.length){
      await recordSecurityEvent({
        route: '/factory/checkout',
        ...actor,
        severity: 'HIGH',
        eventType: 'CARD_DATA_REJECTED',
        message: 'Se rechazó un intento de enviar datos de tarjeta al checkout.',
        metadata: { fields: forbiddenFields },
      });
      return res.status(400).json({ error: 'Talento PyME no acepta datos de tarjeta en este endpoint' });
    }

    assertNoCardData(req.body || {});
    const quote = await buildFactoryQuote(company.id, req.body?.items || [], req.body?.couponCode || '');
    if(!quote.items.length) return res.status(400).json({ error: 'El carrito está vacío.' });

    const billing = normalizeBillingForStorage(req.body?.billing || {}, company, user);
    if(!billing.billingName) return res.status(400).json({ error: 'Falta la razón social.' });
    if(!billing.billingTaxId) return res.status(400).json({ error: 'Falta el CUIT para la factura.' });
    if(!billing.billingEmail) return res.status(400).json({ error: 'Falta el e-mail de facturación.' });

    if(Number(quote.total || 0) <= 0){
      const blockingTicket = await findBlockingFreeTicket(company.id);
      if(blockingTicket){
        return res.status(409).json({
          error: blockingTicket.pendingValidation
            ? `Ya tenés un ticket de prueba generado (${blockingTicket.ticketNo}) pendiente de validación. Confirmalo o cancelalo antes de emitir otro.`
            : `Ya tenés un ticket de prueba activo (${blockingTicket.ticketNo}) con ${blockingTicket.remainingPublications} publicaciones y ${blockingTicket.remainingSearches} búsquedas pendientes de uso. Terminá de usarlo o esperá a su vencimiento antes de emitir otro.`,
          activeFreeTicket: {
            orderId: blockingTicket.order.id,
            ticketNo: blockingTicket.ticketNo,
            expiresAt: blockingTicket.expiresAt,
            remainingPublications: blockingTicket.remainingPublications,
            remainingSearches: blockingTicket.remainingSearches,
            pendingValidation: !!blockingTicket.pendingValidation,
          },
        });
      }
    }

    order = await createPendingPaymentOrder({ company, user, billing, quote });

    if(Number(quote.total || 0) <= 0){
      await prisma.billingOrder.update({ where: { id: order.id }, data: { paymentProvider: 'INTERNAL_TICKET', paymentNote: 'PROMOTIONAL_ZERO_TICKET' } }).catch(() => null);
      order = await issueZeroAmountTicket(order, actor);
      return res.json({
        ok: true,
        ticketIssued: true,
        message: 'Promoción activada. El ticket interno sin cargo quedó validado y la capacidad de prueba ya está disponible para operar.',
        orderId: order.id,
        status: order.status,
        provider: 'INTERNAL_TICKET',
        ticketNo: buildInternalTicketNumber(order.id),
        order: orderToSummary(order),
        quote,
      });
    }

    let providerSession;
    try {
      providerSession = await getPaymentProvider().createCheckoutSession({
        order: {
          id: order.id,
          companyId: company.id,
          billingEmail: billing.billingEmail,
          total: quote.total,
          totalDays: quote.totalDays,
          totalOpenings: quote.totalOpenings,
          totalPublications: quote.totalPublications,
          itemsSummary: quote.items.map((it) => `${it.planName} x${it.quantity}`).join(' · '),
        },
        company,
        billing,
        items: quote.items,
        quote,
        successUrl: buildPaymentSuccessUrl(order.id),
        cancelUrl: buildPaymentCancelUrl(order.id),
        webhookUrl: PAYMENT_WEBHOOK_URL || (APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, '')}/payments/webhook/provider` : ''),
      });
    } catch (providerErr) {
      await prisma.billingOrder.update({ where: { id: order.id }, data: { paymentFailureReason: providerErr.message } }).catch(() => null);
      await recordSecurityEvent({
        route: '/factory/checkout',
        ...actor,
        orderId: order.id,
        severity: 'HIGH',
        eventType: 'CHECKOUT_SESSION_CREATE_FAILED',
        message: providerErr.message || 'No se pudo crear la sesión de checkout.',
        metadata: { provider: PAYMENT_PROVIDER_NAME, request: sanitizeCheckoutPayloadForLog(req.body || {}) },
      });
      throw providerErr;
    }

    order = await prisma.billingOrder.update({
      where: { id: order.id },
      data: {
        paymentProvider: providerSession.provider || PAYMENT_PROVIDER_NAME,
        paymentSessionRef: providerSession.sessionId || null,
        paymentProviderRef: providerSession.providerOrderId || null,
      },
      include: { company: true, items: true }
    });

    await recordSecurityEvent({
      route: '/factory/checkout',
      ...actor,
      orderId: order.id,
      severity: 'INFO',
      eventType: 'CHECKOUT_SESSION_CREATED',
      message: 'Pedido de Factory creado y derivado a un proveedor externo seguro.',
      metadata: { provider: providerSession.provider || PAYMENT_PROVIDER_NAME, sessionId: providerSession.sessionId || null },
    });

    return res.json({
      ok: true,
      message: 'Pedido creado. Serás redirigido a un proveedor externo seguro para completar el pago. Talento PyME no procesa directamente los datos de tu tarjeta.',
      orderId: order.id,
      status: order.status,
      provider: providerSession.provider || PAYMENT_PROVIDER_NAME,
      checkoutUrl: providerSession.checkoutUrl,
      order: orderToSummary(order),
      quote,
    });
  } catch (err) {
    const statusCode = err?.statusCode || (err instanceof PaymentSecurityError ? 400 : (err instanceof PaymentProviderError ? 502 : 500));
    console.error('POST /factory/checkout', { statusCode, message: err?.message || 'Error de checkout', orderId: order?.id || null });
    return res.status(statusCode).json({ error: err?.message || 'No se pudo registrar el pedido' });
  }
});

app.post('/factory/tickets/:orderId/validate', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  try {
    const { company, user } = await getCompanyContextByUserId(req.user.id);
    await expireStalePendingOrders(company.id);
    const actor = minimalActorMeta(user, company);
    const orderId = String(req.params?.orderId || '').trim();
    if(!orderId) return res.status(400).json({ error: 'Falta identificar el ticket.' });
    let order = await prisma.billingOrder.findFirst({ where: { id: orderId, companyId: company.id }, include: { company: true, items: true } }).catch(() => null);
    if(!order) return res.status(404).json({ error: 'No se encontró el ticket solicitado.' });
    if(Number(order.total || 0) > 0) return res.status(400).json({ error: 'Este pedido no se valida como ticket sin cargo.' });
    if(String(order.paymentProvider || '').toUpperCase() !== 'INTERNAL_TICKET') return res.status(400).json({ error: 'Este documento no corresponde a un ticket de validez.' });
    if(order.status === 'PAID') return res.json({ ok: true, alreadyValidated: true, message: 'El ticket ya había sido validado y la capacidad sigue operativa.', ticketNo: buildInternalTicketNumber(order.id), order: orderToSummary(order) });

    const blockingTicket = await findBlockingFreeTicket(company.id, order.id);
    if(blockingTicket){
      return res.status(409).json({ error: blockingTicket.pendingValidation ? `Ya existe otro ticket (${blockingTicket.ticketNo}) pendiente de validación. Resolvé ese ticket antes de validar este nuevo.` : `Ya existe otro ticket activo (${blockingTicket.ticketNo}) con capacidad vigente. Terminá de usarlo o esperá a su vencimiento antes de validar este nuevo ticket.` });
    }

    order = await issueZeroAmountTicket(order, actor);
    return res.json({
      ok: true,
      ticketIssued: true,
      message: 'Ticket de validez confirmado. La capacidad sin cargo quedó habilitada para publicar, buscar y evaluar el sistema con trazabilidad completa.',
      orderId: order.id,
      status: order.status,
      provider: order.paymentProvider,
      ticketNo: buildInternalTicketNumber(order.id),
      order: orderToSummary(order),
    });
  } catch (err) {
    console.error('POST /factory/tickets/:orderId/validate', err);
    return res.status(500).json({ error: 'No se pudo validar el ticket interno.' });
  }
});

app.post('/payments/webhook/provider', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const signatureHeader = req.get('stripe-signature') || req.get('x-payment-signature') || req.get('x-signature') || '';
  let eventRecord = null;
  try {
    const provider = getPaymentProvider();
    const signatureValid = provider.verifyWebhook(signatureHeader, rawBody, req.headers);
    if(!signatureValid){
      await recordSecurityEvent({
        route: '/payments/webhook/provider',
        severity: 'HIGH',
        eventType: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Se rechazó un webhook con firma inválida.',
        metadata: { provider: provider.name },
      });
      return res.status(400).json({ error: 'Firma inválida.' });
    }

    const parsed = provider.parseWebhookEvent(rawBody, req.headers);
    if(!parsed?.providerEventId){
      await recordSecurityEvent({
        route: '/payments/webhook/provider',
        severity: 'HIGH',
        eventType: 'INVALID_WEBHOOK_EVENT',
        message: 'El webhook llegó sin identificador de evento.',
        metadata: { provider: provider.name },
      });
      return res.status(400).json({ error: 'Evento inválido.' });
    }

    const replay = await prisma.paymentWebhookEvent.findUnique({ where: { provider_providerEventId: { provider: parsed.provider, providerEventId: parsed.providerEventId } } }).catch(() => null);
    if(replay){
      await recordSecurityEvent({
        route: '/payments/webhook/provider',
        severity: 'WARN',
        eventType: 'WEBHOOK_REPLAY_DETECTED',
        orderId: replay.orderId || null,
        message: 'Se recibió un webhook repetido y fue ignorado por idempotencia.',
        metadata: { provider: parsed.provider, providerEventId: parsed.providerEventId },
      });
      return res.json({ ok: true, idempotent: true });
    }

    const order = parsed.orderId
      ? await prisma.billingOrder.findUnique({ where: { id: parsed.orderId }, include: { company: true, items: true } }).catch(() => null)
      : null;

    eventRecord = await recordPaymentWebhookEvent(parsed, true, rawBody, order?.id || null).catch(() => null);

    if(!order){
      await recordSecurityEvent({
        route: '/payments/webhook/provider',
        severity: 'HIGH',
        eventType: 'PAYMENT_ORDER_NOT_FOUND',
        message: 'El proveedor reportó un pago para una orden inexistente.',
        metadata: { provider: parsed.provider, providerEventId: parsed.providerEventId, orderId: parsed.orderId || null },
      });
      if(eventRecord){
        await prisma.paymentWebhookEvent.update({ where: { id: eventRecord.id }, data: { processed: false, errorMessage: 'Orden inexistente.' } }).catch(() => null);
      }
      return res.status(404).json({ error: 'Orden inexistente.' });
    }

    if(parsed.amount != null && Number(parsed.amount) > 0 && Number(parsed.amount) !== Number(order.total || 0)){
      await recordSecurityEvent({
        route: '/payments/webhook/provider',
        severity: 'HIGH',
        eventType: 'PAYMENT_AMOUNT_MISMATCH',
        orderId: order.id,
        actorCompanyId: order.companyId,
        message: 'El importe informado por el proveedor no coincide con la orden.',
        metadata: { expected: Number(order.total || 0), received: Number(parsed.amount || 0), provider: parsed.provider },
      });
      if(eventRecord){
        await prisma.paymentWebhookEvent.update({ where: { id: eventRecord.id }, data: { processed: false, errorMessage: 'Monto inconsistente.' } }).catch(() => null);
      }
      return res.status(409).json({ error: 'Monto inconsistente.' });
    }

    const updatedOrder = await updateOrderStatusFromProvider(order, parsed);
    if(eventRecord){
      await prisma.paymentWebhookEvent.update({ where: { id: eventRecord.id }, data: { processed: true, processedAt: new Date(), orderId: updatedOrder.id, outcome: parsed.outcome || null } }).catch(() => null);
    }

    await recordSecurityEvent({
      route: '/payments/webhook/provider',
      severity: 'INFO',
      eventType: 'PAYMENT_STATUS_CHANGED',
      orderId: updatedOrder.id,
      actorCompanyId: updatedOrder.companyId,
      message: `El webhook confirmó el cambio de estado a ${updatedOrder.status}.`,
      metadata: { provider: parsed.provider, providerEventId: parsed.providerEventId, eventType: parsed.eventType },
    });

    return res.json({ ok: true });
  } catch (err) {
    if(eventRecord){
      await prisma.paymentWebhookEvent.update({ where: { id: eventRecord.id }, data: { processed: false, errorMessage: err?.message || 'Error de procesamiento.' } }).catch(() => null);
    }
    await recordSecurityEvent({
      route: '/payments/webhook/provider',
      severity: 'HIGH',
      eventType: 'WEBHOOK_PROCESSING_ERROR',
      message: err?.message || 'Falló el procesamiento del webhook.',
      metadata: { provider: PAYMENT_PROVIDER_NAME },
    });
    const statusCode = err?.statusCode || 500;
    return res.status(statusCode).json({ error: err?.message || 'No se pudo procesar el webhook.' });
  }
});

app.post('/factory/admin/unlock', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), async (req, res) => {
  const { company } = await getCompanyContextByUserId(req.user.id);
  if(!factoryAdminCompanyMatches(company)){
    return res.status(403).json({ error: factoryAdminVisibilityMessage(company) || 'Factory Admin no está habilitado para esta empresa.' });
  }
  const alias = String(req.body?.alias || '').trim();
  const password = String(req.body?.password || '').trim();
  const legacyKey = String(req.body?.key || '').trim();

  if(FACTORY_ADMIN_ALIAS && FACTORY_ADMIN_PASSWORD){
    if(!alias) return res.status(400).json({ error: 'Ingresá el nombre Factory.' });
    if(!password) return res.status(400).json({ error: 'Ingresá la clave Factory.' });
    if(alias !== FACTORY_ADMIN_ALIAS || password !== FACTORY_ADMIN_PASSWORD){
      return res.status(403).json({ error: 'Nombre Factory o clave incorrectos.' });
    }
    return res.json({ ok: true, unlocked: true, mode: 'alias_password' });
  }

  if(FACTORY_SUPERADMIN_KEY){
    if(!legacyKey || legacyKey !== FACTORY_SUPERADMIN_KEY) return res.status(403).json({ error: 'Clave de superadministración incorrecta.' });
    return res.json({ ok: true, unlocked: true, mode: 'legacy_key' });
  }

  return res.status(503).json({ error: 'Factory Admin no está configurado en Render.' });
});

app.get('/factory/admin/bootstrap', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), requireFactoryAdmin, async (req, res) => {
  try {
    const plans = await getFactoryPlans(true);
    const companies = await prisma.companyProfile.findMany({ orderBy: { companyName: 'asc' }, select: { id: true, companyName: true, cuit: true, contactEmail: true } }).catch(() => []);
    const coupons = await prisma.factoryCoupon.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => []);
    const grants = await prisma.companyFactoryGrant.findMany({ include: { company: { select: { companyName: true, cuit: true } } }, orderBy: { fullAccessUntil: 'desc' }, take: 100 }).catch(() => []);
    res.json({
      ok: true,
      plans,
      companies,
      coupons: coupons.filter((row)=> row.isActive),
      usedCoupons: coupons.filter((row)=> !row.isActive),
      grants,
      supportEmail: FACTORY_SUPPORT_EMAIL,
    });
  } catch (err) {
    console.error('GET /factory/admin/bootstrap', err);
    res.status(500).json({ error: 'No se pudo cargar la consola Factory Admin.' });
  }
});

app.post('/factory/admin/plans', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), requireFactoryAdmin, async (req, res) => {
  try {
    const plans = Array.isArray(req.body?.plans) ? req.body.plans : [];
    if(!plans.length) return res.status(400).json({ error: 'Faltan planes para guardar.' });
    await prisma.$transaction(plans.map((plan, idx) => {
      const code = String(plan.code || '').trim().toUpperCase();
      if(!code) throw new Error('Cada plan debe tener código.');
      return prisma.factoryPlanConfig.upsert({
        where: { code },
        update: {
          name: String(plan.name || '').trim() || `Plan ${code}`,
          days: Math.max(1, Number(plan.days || 0)),
          price: moneyInt(plan.price || 0),
          publicationsLimit: Math.max(0, Number(plan.publications || 0)),
          searchesLimit: Math.max(0, Number(plan.searches || 0)),
          sortOrder: idx,
          active: !!plan.active,
        },
        create: {
          code,
          name: String(plan.name || '').trim() || `Plan ${code}`,
          days: Math.max(1, Number(plan.days || 0)),
          price: moneyInt(plan.price || 0),
          publicationsLimit: Math.max(0, Number(plan.publications || 0)),
          searchesLimit: Math.max(0, Number(plan.searches || 0)),
          sortOrder: idx,
          active: !!plan.active,
        }
      });
    }));
    res.json({ ok: true, plans: await getFactoryPlans(true) });
  } catch (err) {
    console.error('POST /factory/admin/plans', err);
    res.status(500).json({ error: err?.message || 'No se pudo guardar la matriz de planes.' });
  }
});

app.post('/factory/admin/coupons', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), requireFactoryAdmin, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const discountPct = Math.max(10, Math.min(100, Number(req.body?.discountPct || 0)));
    const companyId = String(req.body?.companyId || '').trim() || null;
    if(!code) return res.status(400).json({ error: 'Ingresá un código para la bonificación.' });
    await prisma.factoryCoupon.upsert({
      where: { code },
      update: { label: `Bonificación ${discountPct}%`, discountPct, companyId, grantsFullAccess: false, fullAccessUntil: null, isActive: true, singleUsePerCompany: true },
      create: { code, label: `Bonificación ${discountPct}%`, discountPct, companyId, grantsFullAccess: false, fullAccessUntil: null, isActive: true, singleUsePerCompany: true }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /factory/admin/coupons', err);
    res.status(500).json({ error: 'No se pudo guardar el código de bonificación.' });
  }
});

app.post('/factory/admin/full-access', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), requireFactoryAdmin, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const companyId = String(req.body?.companyId || '').trim();
    const untilMonth = String(req.body?.untilMonth || '').trim();
    if(!code || !companyId || !untilMonth) return res.status(400).json({ error: 'Completá empresa, código y mes de vigencia.' });
    const until = new Date(`${untilMonth}-01T00:00:00.000Z`);
    if(Number.isNaN(until.getTime())) return res.status(400).json({ error: 'Mes inválido.' });
    const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    await prisma.factoryCoupon.upsert({
      where: { code },
      update: { label: `Acceso total hasta ${untilMonth}`, discountPct: 100, companyId, grantsFullAccess: true, fullAccessUntil: end, isActive: true, singleUsePerCompany: true },
      create: { code, label: `Acceso total hasta ${untilMonth}`, discountPct: 100, companyId, grantsFullAccess: true, fullAccessUntil: end, isActive: true, singleUsePerCompany: true }
    });
    res.json({ ok: true, until: end });
  } catch (err) {
    console.error('POST /factory/admin/full-access', err);
    res.status(500).json({ error: 'No se pudo guardar el código de acceso total.' });
  }
});

app.get('/factory/admin/orders', auth, requireAnyRole(['COMPANY','SUPERADMIN','ADMIN']), requireFactoryAdmin, async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const days = req.query?.days ? Number(req.query.days) : null;
    const sort = String(req.query?.sort || 'newest');
    const rows = await prisma.billingOrder.findMany({
      include: { company: true, items: true },
      orderBy: { createdAt: sort === 'oldest' ? 'asc' : 'desc' }
    });
    const filtered = rows.filter((row) => {
      const name = String(row.company?.companyName || row.companyNameSnapshot || '').toLowerCase();
      const cuit = String(row.company?.cuit || row.cuitSnapshot || '').toLowerCase();
      const matchQ = !q || name.includes(q) || cuit.includes(q);
      const matchDays = !days || (row.totalDays || 0) === days;
      return matchQ && matchDays;
    }).map(orderToSummary);
    const grouped = Object.values(filtered.reduce((acc, row) => {
      const key = row.companyName;
      if(!acc[key]) acc[key] = { companyName: row.companyName, companyCode: row.companyCode, documents: [] };
      acc[key].documents.push(row);
      return acc;
    }, {})).sort((a,b)=> a.companyName.localeCompare(b.companyName, 'es'));
    res.json({ ok: true, items: grouped });
  } catch (err) {
    console.error('GET /factory/admin/orders', err);
    res.status(500).json({ error: 'No se pudo leer el panel administrador' });
  }
});


app.get('/company/candidates', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const company = await prisma.companyProfile.findUnique({ where: { userId: req.user.id }, select: { candidateBookmarks: true } });
    const ids = company?.candidateBookmarks || [];
    if (!ids.length) return res.json({ ok: true, items: [] });
    const all = await prisma.candidateBolsa.findMany({
      where: { id: { in: ids } },
      select: {
        id:true, nombre:true, apellido:true, dni:true, nacionalidad:true, estadoCivil:true, hijos:true,
        telefono:true, telefonoAdicional:true, fechaNacimiento:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, voiceNarrativeSummary:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true
      }
    });
    const byId = new Map(all.map((it)=>[it.id, it]));
    const applications = await prisma.application.findMany({ where: { job: { company: { userId: req.user.id } } }, include: { user: { include: { candidateBolsa: true } }, job: true }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    const appliedByBolsaId = new Map();
    for (const app of applications || []) {
      const bid = app.user?.candidateBolsa?.id;
      if (!bid) continue;
      if (!appliedByBolsaId.has(bid)) appliedByBolsaId.set(bid, []);
      appliedByBolsaId.get(bid).push({ jobId: app.jobId, jobTitle: app.job?.title || '', appliedAt: app.createdAt });
    }
    const items = ids.map((id)=>byId.get(id)).filter(Boolean).map((it)=>({
      id: it.id,
      nombre: it.nombre,
      apellido: it.apellido,
      dni: it.dni,
      nacionalidad: it.nacionalidad,
      estado_civil: it.estadoCivil,
      hijos: it.hijos,
      telefono: it.telefono,
      correo: it.correo,
      localidad: it.localidad,
      direccion: it.direccion,
      area_trabajo: it.areaTrabajo,
      nivel: it.nivel,
      especialidad: it.especialidad,
      especialidad_otro: it.especialidadOtro,
      rango_experiencia: it.rangoExperiencia,
      nivel_educativo: it.nivelEducativo,
      tiene_capacitacion: it.tieneCapacitacion,
      trabaja_actualmente: it.trabajaActualmente,
      sueldo_pretendido: it.sueldoPretendido,
      ultimo_trabajo: it.ultimoTrabajo,
      observaciones: it.observaciones,
      presentacion_profesional: it.voiceNarrativeSummary || '',
      photoDataUrl: it.photoDataUrl,
      herramientas_mecanica: toArrayField(it.herramientasMecanica),
      instrumentos_electrica: toArrayField(it.instrumentosElectrica),
      created_at: it.createdAt,
      updated_at: it.updatedAt,
      sourceLabel: appliedByBolsaId.has(it.id) ? 'Postulación desde Mis Oportunidades' : 'Guardado por la empresa',
      applications: appliedByBolsaId.get(it.id) || []
    }));
    res.json({ ok: true, items });
  } catch (err) {
    console.error('GET /company/candidates', err);
    res.status(500).json({ error: 'No se pudo leer Mis Candidatos' });
  }
});

app.post('/company/candidates', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const candidateId = String(req.body?.candidateId || '').trim();
    if (!candidateId) return res.status(400).json({ error: 'Falta candidateId' });
    const exists = await prisma.candidateBolsa.findUnique({ where: { id: candidateId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Candidato no encontrado' });
    const current = await prisma.companyProfile.findUnique({ where: { userId: req.user.id }, select: { candidateBookmarks: true } });
    const next = Array.from(new Set([...(current?.candidateBookmarks || []), candidateId]));
    await prisma.companyProfile.upsert({
      where: { userId: req.user.id },
      update: { candidateBookmarks: next },
      create: { userId: req.user.id, companyName: 'Empresa', candidateBookmarks: next }
    });
    res.json({ ok: true, saved: true, total: next.length });
  } catch (err) {
    console.error('POST /company/candidates', err);
    res.status(500).json({ error: 'No se pudo guardar en Mis Candidatos' });
  }
});

app.delete('/company/candidates/:id', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const candidateId = String(req.params.id || '').trim();
    const current = await prisma.companyProfile.findUnique({ where: { userId: req.user.id }, select: { candidateBookmarks: true } });
    const next = (current?.candidateBookmarks || []).filter((id)=> id !== candidateId);
    await prisma.companyProfile.upsert({
      where: { userId: req.user.id },
      update: { candidateBookmarks: next },
      create: { userId: req.user.id, companyName: 'Empresa', candidateBookmarks: next }
    });
    res.json({ ok: true, removed: true, total: next.length });
  } catch (err) {
    console.error('DELETE /company/candidates/:id', err);
    res.status(500).json({ error: 'No se pudo quitar de Mis Candidatos' });
  }
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

app.post('/jobs/ai-draft', auth, requireRole('COMPANY'), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const seniority = String(req.body?.seniority || '').trim() || 'semi senior';
    const area = String(req.body?.area || '').trim() || 'industrial';
    const companyName = String(req.body?.companyName || '').trim() || 'la empresa';
    const companySummary = String(req.body?.companySummary || '').trim();
    const responsibilities = String(req.body?.responsibilities || '').trim();
    const skills = String(req.body?.skills || '').trim();
    const modality = String(req.body?.modality || '').trim() || 'presencial';
    const location = String(req.body?.location || '').trim();
    if (!title) return res.status(400).json({ error: 'Falta el título del puesto' });
    const lead = `${companyName} busca incorporar un/a ${title} para su operación ${area}${location ? ` en ${location}` : ''}.`;
    const context = companySummary ? ` La organización se dedica a ${companySummary.replace(/^\s*La empresa se dedica principalmente a\s*/i,'').trim()}` : '';
    const description = [
      lead + context,
      `La posición está orientada a perfiles ${seniority} con capacidad para liderar, coordinar y ejecutar tareas vinculadas a ${area}, asegurando seguridad, cumplimiento y mejora continua.`,
      responsibilities || `Entre sus responsabilidades se espera la organización diaria del sector, coordinación con producción y mantenimiento, seguimiento de indicadores, resolución de desvíos y propuesta de mejoras sostenibles.`,
      `La modalidad de trabajo prevista es ${modality}.`
    ].join(' ');
    const requirements = [
      `Se valorará experiencia previa en roles afines y dominio técnico acorde al nivel ${seniority}.`,
      skills ? `Conocimientos clave buscados: ${skills}.` : 'Se valorarán conocimientos técnicos del puesto, lectura de procesos, trabajo en equipo y foco en resultados.',
      'También se considerará positivamente la capacidad de comunicación, liderazgo operativo, orden documental y orientación a mejora continua.'
    ].join(' ');
    res.json({ ok: true, description, requirements });
  } catch (err) {
    console.error('POST /jobs/ai-draft', err);
    res.status(500).json({ error: 'No se pudo generar el borrador asistido' });
  }
});

app.post("/jobs", auth, requireRole("COMPANY"), async (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const c = await prisma.companyProfile.findUnique({ where: { userId: req.user.id } });
  if (!c) return res.status(400).json({ error: "Empresa no configurada" });

  const quota = await consumeCompanyQuota(c.id, 'publication');
  if(!quota.ok) return res.status(402).json({ error: quota.error, operationUsage: quota.usage || null });

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
      status: "PUBLISHED",
      visibleToCandidates: true
    }
  });

  if(quota.sourceItem && quota.expiresAt){
    await prisma.companyJobPublication.create({
      data: {
        companyId: c.id,
        jobId: job.id,
        orderItemId: quota.sourceItem.orderItemId,
        expiresAt: quota.expiresAt,
      }
    }).catch(async (err) => {
      await prisma.job.delete({ where: { id: job.id } }).catch(() => null);
      throw err;
    });
  }

  res.json({ ...job, operationUsage: await getCompanyOperationUsage(c.id) });
});

app.get("/jobs", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const categoryId = String(req.query.categoryId || "").trim();

  const where = { status: "PUBLISHED", visibleToCandidates: true, company: { is: { hiddenFromSearch: false } } };
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
  const jobs = await prisma.job.findMany({
    where: { companyId: c.id },
    orderBy: { createdAt: "desc" },
    include: {
      applications: { include: { user: { include: { candidateBolsa: true } } } }
    }
  });
  const mapped = jobs.map((job)=> {
    const salaries = (job.applications || []).map((app)=> String(app.user?.candidateBolsa?.sueldoPretendido || '').trim()).filter(Boolean);
    const uniqueSalaries = Array.from(new Set(salaries));
    return {
      ...job,
      applicationsCount: (job.applications || []).length,
      salaryPretensions: uniqueSalaries.slice(0, 4),
      salaryPretensionsCount: uniqueSalaries.length,
    };
  });
  res.json({ jobs: mapped, operationUsage: await getCompanyOperationUsage(c.id) });
});

app.patch("/jobs/:id", auth, requireRole("COMPANY"), async (req, res) => {
  try{
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if(!job || job.company?.userId !== req.user.id) return res.status(404).json({ error: "Búsqueda no encontrada" });
    const visibleToCandidates = typeof req.body?.visibleToCandidates === 'boolean' ? req.body.visibleToCandidates : job.visibleToCandidates;
    const updated = await prisma.job.update({ where: { id: job.id }, data: { visibleToCandidates } });
    res.json(updated);
  }catch(err){
    console.error('PATCH /jobs/:id', err);
    res.status(500).json({ error: 'No se pudo actualizar la búsqueda' });
  }
});

app.delete("/jobs/:id", auth, requireRole("COMPANY"), async (req, res) => {
  try{
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { company: true, _count: { select: { applications: true } } }
    });
    if(!job || job.company?.userId !== req.user.id) return res.status(404).json({ error: "Búsqueda no encontrada" });

    // v8.0.1: si ya existen postulaciones, preservamos la trazabilidad y evitamos
    // la violación Application_jobId_fkey. Para el usuario la búsqueda desaparece
    // de las oportunidades activas, pero las postulaciones históricas siguen íntegras.
    if(Number(job._count?.applications || 0) > 0){
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "CLOSED", visibleToCandidates: false }
      });
      return res.json({ ok:true, deleted:false, archived:true, message:"La búsqueda tenía postulaciones y fue cerrada para conservar el historial." });
    }

    await prisma.job.delete({ where: { id: job.id } });
    res.json({ ok:true, deleted:true, archived:false, message:"Búsqueda eliminada." });
  }catch(err){
    console.error('DELETE /jobs/:id', err);
    res.status(500).json({ error: 'No se pudo eliminar la búsqueda' });
  }
});

const applySchema = z.object({ coverNote: z.string().max(4000).optional().nullable() });

app.post("/jobs/:id/apply", auth, requireRole("CANDIDATE"), async (req, res) => {
  const jobId = req.params.id;
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { company: true } });
  if (!job) return res.status(404).json({ error: "Búsqueda no encontrada" });

  try {
    const row = await prisma.application.create({ data: { jobId, userId: req.user.id, coverNote: parsed.data.coverNote ?? null } });
    const bolsa = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id }, select: { id: true } }).catch(() => null);
    if (bolsa?.id && job.company?.userId) {
      const current = await prisma.companyProfile.findUnique({ where: { userId: job.company.userId }, select: { candidateBookmarks: true } }).catch(() => null);
      const next = Array.from(new Set([...(current?.candidateBookmarks || []), bolsa.id]));
      await prisma.companyProfile.upsert({
        where: { userId: job.company.userId },
        update: { candidateBookmarks: next },
        create: { userId: job.company.userId, companyName: job.company.companyName || 'Empresa', candidateBookmarks: next }
      });
    }
    res.json({ ok: true, application: row, source: 'candidate_portal' });
  } catch {
    res.status(409).json({ error: "Ya postulaste a esta búsqueda" });
  }
});

app.get("/jobs/applications/mine", auth, requireRole("CANDIDATE"), async (req, res) => {
  try {
    const items = await prisma.application.findMany({
      where: { userId: req.user.id },
      include: { job: { include: { company: true, category: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ ok: true, items });
  } catch (err) {
    console.error('GET /jobs/applications/mine', err);
    res.status(500).json({ error: 'No se pudieron leer tus postulaciones' });
  }
});

app.delete("/jobs/applications/:id", auth, requireRole("CANDIDATE"), async (req, res) => {
  try {
    const appRow = await prisma.application.findUnique({ where: { id: req.params.id }, include: { job: { include: { company: true } } } });
    if (!appRow || appRow.userId !== req.user.id) return res.status(404).json({ error: 'Postulación no encontrada' });
    await prisma.application.delete({ where: { id: appRow.id } });
    // Si estaba guardado en la carpeta de la empresa por esta postulación, intentamos quitarlo.
    const bolsa = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id }, select: { id: true } }).catch(() => null);
    const companyUserId = appRow.job?.company?.userId;
    if (bolsa?.id && companyUserId) {
      const current = await prisma.companyProfile.findUnique({ where: { userId: companyUserId }, select: { candidateBookmarks: true } }).catch(() => null);
      const applicationsLeft = await prisma.application.findFirst({ where: { userId: req.user.id, job: { company: { userId: companyUserId } } } }).catch(() => null);
      if (!applicationsLeft && current?.candidateBookmarks?.includes(bolsa.id)) {
        const next = (current.candidateBookmarks || []).filter(id => id !== bolsa.id);
        await prisma.companyProfile.update({ where: { userId: companyUserId }, data: { candidateBookmarks: next } }).catch(() => null);
      }
    }
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('DELETE /jobs/applications/:id', err);
    res.status(500).json({ error: 'No se pudo eliminar la postulación' });
  }
});

// -----------------------------
// Search talent (para empresas, gratis)
// -----------------------------
// Endpoint legado retirado: evitaba los controles actuales de privacidad y capacidad.
app.get("/search", (_req, res) => res.status(410).json({
  error:"LEGACY_SEARCH_DISABLED",
  message:"Este buscador fue retirado. Usá los módulos actuales de Talento PyME.",
}));




const SUPPORT_KNOWLEDGE_SEEDS = [
  { scope: 'GLOBAL', keywords: ['registro perfil completar datos formulario candidato voz micrófono cv observaciones resumen curricular foto'], questionSample: '¿Qué tengo que completar en mi perfil?', answer: 'Podés empezar con tus datos personales y una presentación por voz o texto contando qué sabés hacer, en qué trabajás o qué te gustaría aprender. Guardala y volvé cuando quieras para completar perfil laboral, experiencia, formación, foto y CV. Talento PyME también puede generar un CV PDF con la información guardada.' },
  { scope: 'CANDIDATE', keywords: ['mi perfil candidato voz micrófono foto cv pdf observaciones resumen curricular guardar editar'], questionSample: '¿Cómo completo Mi Perfil?', answer: 'En Mi Perfil tenés seis etapas. Después de los datos personales podés dictar o escribir una presentación profesional, revisarla y guardarla aunque todavía no tengas CV. Luego podés completar experiencia, formación, cargar foto y CV. Cuando quieras, usá “Descargar mi CV PDF” para llevarte una versión profesional actualizada.' },
  { scope: 'CANDIDATE', keywords: ['mis oportunidades postularme postulaciones eliminar postulación'], questionSample: '¿Cómo me postulo?', answer: 'Desde Mis Oportunidades buscás avisos y, cuando un puesto te interesa, lo pasás a Mis Postulaciones. Ahí queda registrada tu postulación y podés revisarla o eliminarla si ya no querés seguir en ese proceso.' },
  { scope: 'COMPANY', keywords: ['buscar talento filtros texto libre resumen curricular observaciones herramientas instrumentacion'], questionSample: '¿Cómo funciona Buscar Talento?', answer: 'Buscar Talento permite filtrar por área, especialidad, experiencia, educación, herramientas, instrumentación y texto libre. El texto libre también revisa el resumen curricular, observaciones, último trabajo y otros datos clave del perfil para ampliar coincidencias útiles.' },
  { scope: 'COMPANY', keywords: ['mis candidatos guardados postulaciones recibidas pretension economica sueldo'], questionSample: '¿Qué veo en Mis Candidatos?', answer: 'En Mis Candidatos se listan los perfiles guardados o recibidos desde postulaciones. Vas a ver datos resumidos del perfil, la pretensión económica en formato contable y, al abrir una ficha completa, se consume capacidad si corresponde según el plan vigente.' },
  { scope: 'COMPANY', keywords: ['mis busquedas publicar busqueda publicaciones cupo plan'], questionSample: '¿Cómo se consume la capacidad de publicaciones?', answer: 'Cada vez que publicás una búsqueda se descuenta capacidad del plan activo de la empresa. El sistema muestra el saldo operativo para que puedas controlar cuántas publicaciones y búsquedas te quedan disponibles.' },
  { scope: 'COMPANY', keywords: ['factory planes publicaciones busquedas compra bonificacion iva carrito checkout'], questionSample: '¿Cómo funcionan los planes de Factory?', answer: 'Factory permite contratar capacidad por tiempo. Cada plan habilita días, publicaciones y búsquedas. El precio publicado es sin IVA, el impuesto se suma al confirmar la compra y los códigos de bonificación válidos se aplican una sola vez. El pago se completa en un proveedor externo seguro y la orden solo queda pagada cuando el proveedor la confirma.' },
  { scope: 'COMPANY', keywords: ['abrir ficha candidato aperturas creditos saldo capacidad operativa'], questionSample: '¿Cómo se consumen los créditos?', answer: 'La empresa puede ver resultados resumidos sin consumir crédito. La apertura completa de una ficha consume capacidad según el plan activo o el acceso especial vigente. El panel comercial muestra el saldo disponible para operar.' },
  { scope: 'COMPANY', keywords: ['factory admin matriz planes precio dias publicaciones busquedas bonificaciones acceso free'], questionSample: '¿Para qué sirve Factory Admin?', answer: 'Factory Admin permite editar la matriz comercial de días, publicaciones, búsquedas y precio, generar códigos de bonificación, crear accesos especiales free y revisar la operatoria comercial desde la empresa habilitada para administración.' },
  { scope: 'SUPERADMIN', keywords: ['panel general empresas candidatos estadisticas chat operador conocimiento'], questionSample: '¿Qué muestra el Panel General?', answer: 'El Panel General reúne estadísticas globales del sistema, listados de empresas y candidatos, actividad comercial y el centro de conversaciones para operador. Desde ahí también se administra el conocimiento reutilizable del chat de ayuda.' },
  { scope:'CANDIDATE', keywords:['foto cámara sacar foto selfie imagen perfil'], questionSample:'¿Cómo cargo o saco una foto para mi perfil?', answer:'En Mi Perfil buscá Foto de perfil. Podés elegir una imagen del teléfono o la computadora y, cuando el dispositivo lo permita, usar la cámara. Elegí una foto reciente, de frente, con buena luz y fondo simple. Confirmá la carga y guardá los cambios. Si la cámara no aparece, revisá los permisos del navegador.' },
  { scope:'CANDIDATE', keywords:['cv pdf docx txt subir archivo no me deja curriculum'], questionSample:'¿Cómo cargo mi CV y qué hago si no me deja?', answer:'En Mi Perfil, en la sección de CV, seleccioná un archivo PDF, DOCX o TXT. Talento PyME lee el contenido para enriquecer tu perfil. Si no carga, verificá que sea uno de esos formatos, usá el archivo original y probá nuevamente. Después volvé al punto 2 y pulsá Corrección IA profesional para integrar el CV con tu presentación; revisá y guardá.' },
  { scope:'CANDIDATE', keywords:['punto 2 corrección ia profesional escribir dictar que se hacer me gustaría hacer'], questionSample:'¿Qué puedo contarle a la IA en el punto 2?', answer:'No necesitás redactar un currículum perfecto. En el punto 2 podés escribir o dictar qué sabés hacer, qué tareas realizaste aunque hayan sido informales, qué herramientas conocés, qué te gusta hacer y qué trabajo te gustaría aprender o desarrollar. Después pulsá Corrección IA profesional: Talento PyME ordena el relato, elimina repeticiones y mejora la redacción sin inventar antecedentes. Revisá el resultado y guardalo.' },
  { scope:'CANDIDATE', keywords:['no encuentro búsqueda no hay puestos cero resultados seguridad higiene supervisor'], questionSample:'¿Qué hago si mi búsqueda no muestra puestos?', answer:'En Mis Oportunidades probá primero términos simples y amplios relacionados con el área o puesto. Si no aparece nada, puede significar que en ese momento no existe una publicación activa con esas palabras; no necesariamente hay un error en tu perfil. Probá sinónimos o una búsqueda más general y revisá nuevamente más adelante.' },
  { scope:'CANDIDATE', keywords:['palabras clave visibilidad empresas encontrar perfil oficio tareas habilidades'], questionSample:'¿Qué palabras conviene agregar para que una empresa me encuentre?', answer:'Usá palabras concretas que describan tareas reales, conocimientos e intereses: por ejemplo electricidad, mecánica, cocina, limpieza, cuidado de personas, atención al cliente, ventas, depósito, logística, construcción, pintura, seguridad, producción, administración o informática. No agregues especialidades que no conocés. Cuanto más precisa sea la descripción de lo que sabés hacer y querés desarrollar, más útil será la búsqueda para una empresa.' }
];

const SUPPORT_SUGGESTIONS = {
  CANDIDATE: [
    '¿Cómo completo Mi Perfil?',
    '¿Cómo cargo mi foto y el CV?',
    '¿Qué datos personales conviene revisar?',
    '¿Cómo completar Observaciones y alcance curricular?',
    '¿Cómo indicar mi pretensión económica?',
    '¿Cómo mejorar mi visibilidad para empresas?',
    '¿Cómo funciona Mis Oportunidades?',
    '¿Cómo postularme a una búsqueda?',
    '¿Qué veo en Mis Postulaciones?',
    '¿Cómo eliminar una postulación?',
    '¿Qué formatos de CV acepta el sistema?',
    '¿Qué pasa si mi CV es muy largo?',
    '¿Cómo actualizar mi perfil sin perder información?',
    '¿Qué datos conviene revisar antes de salir?'
  ],
  COMPANY: [
    '¿Cómo funciona Buscar Talento?',
    '¿Cómo usar el texto libre para encontrar perfiles?',
    '¿Qué filtros conviene combinar primero?',
    '¿Cómo abrir una ficha completa?',
    '¿Cómo se consume la apertura de fichas?',
    '¿Qué veo en Mis Candidatos?',
    '¿Cómo distinguir una postulación de una selección interna?',
    '¿Cómo publicar una búsqueda?',
    '¿Cómo se consume la capacidad de publicaciones?',
    '¿Qué veo en Mis Búsquedas?',
    '¿Cómo funcionan los planes de Factory?',
    '¿Cómo aplicar un código de bonificación?',
    '¿Cómo funciona el pago seguro de un plan?',
    '¿Para qué sirve Factory Admin?'
  ],
  SUPERADMIN: [
    '¿Qué muestra el Panel General?',
    '¿Cómo revisar candidatos y empresas?',
    '¿Cómo funciona el chat operador?',
    '¿Qué puedo editar desde Factory Admin?',
    '¿Cómo se actualiza la matriz comercial?',
    '¿Cómo cambiar días, publicaciones, búsquedas y precio?',
    '¿Cómo se crean bonificaciones y accesos especiales?',
    '¿Cómo habilitar acceso free por empresa?',
    '¿Cómo revisar la facturación y las órdenes?',
    '¿Cómo funciona el ingreso administrativo?',
    '¿Cómo limpiar o responder conversaciones?',
    '¿Cómo validar el comportamiento general del sistema?'
  ]
};

async function ensureSupportKnowledgeSeed(){
  const existing = await prisma.supportKnowledge.findMany({ select: { questionSample: true } }).catch(() => []);
  const known = new Set(existing.map((row) => String(row.questionSample || '').trim()).filter(Boolean));
  const missing = SUPPORT_KNOWLEDGE_SEEDS.filter((row) => !known.has(String(row.questionSample || '').trim()));
  if(!missing.length) return;
  await prisma.$transaction(missing.map((row)=> prisma.supportKnowledge.create({ data: row }))).catch(() => null);
}

function supportMoney(n){
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

function supportDateTime(v){
  try { return new Date(v).toLocaleString('es-AR'); } catch(_) { return ''; }
}

function supportContainsAny(text, patterns){
  const hay = normalizeName(text);
  return patterns.some((p) => {
    if(p instanceof RegExp) return p.test(hay);
    const tok = normalizeName(p);
    return tok && hay.includes(tok);
  });
}

function buildSupportCandidateCompleteness(candidate){
  if(!candidate) return { done: 0, total: 6, percent: 0, pending: ['datos personales','presentación profesional','perfil laboral','trayectoria y pretensión','resumen curricular','foto'] };
  const blocks = [
    { label: 'datos personales', complete: [candidate.dni, candidate.telefono, candidate.correo, candidate.localidad].every((v)=> String(v || '').trim()) },
    { label: 'presentación profesional', complete: String(candidate.voiceNarrativeSummary || '').trim() && String(candidate.voiceNarrativeAnalysisVersion || '').trim() === PRESENTATION_ANALYSIS_VERSION },
    { label: 'perfil laboral', complete: String(candidate.areaTrabajo || '').trim() && String(candidate.rangoExperiencia || '').trim() && String(candidate.nivelEducativo || '').trim() && (String(candidate.especialidad || '').trim() || String(candidate.especialidadOtro || '').trim()) },
    { label: 'pretensión económica y trayectoria', complete: String(candidate.sueldoPretendido || '').trim() && String(candidate.ultimoTrabajo || '').trim() },
    { label: 'resumen curricular', complete: String(candidate.observaciones || '').trim() },
    { label: 'foto de perfil', complete: String(candidate.photoDataUrl || '').trim() },
  ];
  const done = blocks.filter((b)=> b.complete).length;
  return {
    done,
    total: blocks.length,
    percent: Math.round((done / blocks.length) * 100),
    pending: blocks.filter((b)=> !b.complete).map((b)=> b.label)
  };
}

async function buildSupportContext(thread, req){
  const ctx = { role: String(thread?.role || req.user?.role || 'GLOBAL').toUpperCase(), thread, user: req.user || null, company: null, candidate: null, usage: null, adminSummary: null };
  try {
    if(ctx.role === 'CANDIDATE' && req.user?.id && req.user.id !== VIRTUAL_ADMIN_USER_ID){
      ctx.candidate = await prisma.candidateBolsa.findUnique({ where: { userId: req.user.id } }).catch(() => null);
    }
    if(ctx.role === 'COMPANY' && req.user?.id && req.user.id !== VIRTUAL_ADMIN_USER_ID){
      const companyCtx = await getCompanyContextByUserId(req.user.id).catch(() => null);
      ctx.company = companyCtx?.company || null;
      if(ctx.company?.id){
        ctx.usage = await getCompanyOperationUsage(ctx.company.id).catch(() => null);
      }
    }
    if(ctx.role === 'SUPERADMIN'){
      const [candidateCount, companyCount, jobsCount, threadCount] = await Promise.all([
        prisma.candidateBolsa.count().catch(() => 0),
        prisma.companyProfile.count().catch(() => 0),
        prisma.job.count().catch(() => 0),
        prisma.supportThread.count().catch(() => 0),
      ]);
      ctx.adminSummary = { candidateCount, companyCount, jobsCount, threadCount };
    }
  } catch(_) {}
  return ctx;
}

function scoreKnowledgeMatch(message, knowledge){
  const hay = normalizeName(message);
  const keys = Array.isArray(knowledge?.keywords) ? knowledge.keywords : String(knowledge?.keywords || '').split(' ');
  let score = 0;
  const q = normalizeName(knowledge?.questionSample || '');
  if(q && hay === q) score += 10;
  if(q && hay.includes(q)) score += 6;
  for(const raw of keys){
    const tok = normalizeName(raw);
    if(tok && hay.includes(tok)) score += Math.max(1, tok.length > 7 ? 2 : 1);
  }
  return score;
}

// v8.0.6 · clasificación administrativa de cada consulta de Ayuda IA.
// No agrega columnas ni migra Neon: se calcula contra la base de conocimiento vigente
// para que una respuesta reusable del operador pase a cubrir consultas futuras.
function knownSupportIntentScore(message, role){
  const hay = normalizeName(message);
  const normalizedRole = String(role || '').toUpperCase();
  let bestScore = 0;
  let bestIntent = null;
  for(const intent of SUPPORT_INTENTS){
    if(!intent.scopes.includes('GLOBAL') && !intent.scopes.includes(normalizedRole)) continue;
    let score = 0;
    for(const pattern of intent.patterns){
      if(pattern instanceof RegExp){ if(pattern.test(hay)) score += 4; }
      else if(normalizeName(pattern) && hay.includes(normalizeName(pattern))) score += 3;
    }
    if(score > bestScore){ bestScore = score; bestIntent = intent.id; }
  }
  return { score:bestScore, intent:bestIntent };
}

function classifySupportConsultationStatus(message, role, knowledgeRows=[]){
  const value = String(message || '').trim();
  if(!value) return { key:'NEW', label:'Consulta nueva / requiere ampliar respuesta', source:'empty', score:0 };
  if(isGreetingMessage(value) || isInsultMessage(value)) return { key:'COVERED', label:'Tema ya cubierto', source:'system', score:99 };

  const intent = knownSupportIntentScore(value, role);
  if(intent.score > 0) return { key:'COVERED', label:'Tema ya cubierto', source:intent.intent || 'intent', score:intent.score };

  if(String(role || '').toUpperCase()==='CANDIDATE') {
    const topicKey = supportDetailTopicKey(value);
    if(topicKey && topicKey !== 'OTHER') return { key:'COVERED', label:'Tema ya cubierto', source:`guide:${topicKey}`, score:4 };
  }

  let bestKnowledgeScore = 0;
  for(const row of knowledgeRows || []) bestKnowledgeScore = Math.max(bestKnowledgeScore, scoreKnowledgeMatch(value,row));
  // Un solo término genérico no alcanza para declarar una consulta como cubierta.
  if(bestKnowledgeScore >= 3) return { key:'COVERED', label:'Tema ya cubierto', source:'knowledge', score:bestKnowledgeScore };

  return { key:'NEW', label:'Consulta nueva / requiere ampliar respuesta', source:'uncovered', score:bestKnowledgeScore };
}


// v8.0.7 · Bandeja unificada App + Email.
function normalizeMailSubject(value=''){
  return String(value || '').replace(/^\s*(re|fw|fwd):\s*/ig,'').trim();
}

function looksLikeBounceEnvelope(parsed, fromAddress=''){
  const subject=normalizeName(parsed?.subject || '');
  const from=normalizeName(fromAddress || parsed?.from?.text || '');
  const headers=parsed?.headers;
  const autoSubmitted=String(headers?.get?.('auto-submitted') || '').toLowerCase();
  return /mailer daemon|mail delivery subsystem|postmaster/.test(from)
    || /delivery status notification|undeliverable|undelivered|mail delivery failed|failure notice|returned mail|delivery failure/.test(subject)
    || autoSubmitted.includes('auto-replied');
}

function classifyBounceKind(text=''){
  const hay=normalizeName(text);
  const permanent=/5\.1\.[0-9]|5\.0\.0|user unknown|no such user|address not found|recipient address rejected|unknown recipient|does not exist|invalid recipient|mailbox unavailable|bad destination mailbox/.test(String(text||'').toLowerCase())
    || /usuario inexistente|direccion inexistente|destinatario inexistente|correo no existe/.test(hay);
  const temporary=/4\.[0-9]\.[0-9]|mailbox full|quota exceeded|temporarily|temporary failure|try again later|deferred|over quota/.test(String(text||'').toLowerCase())
    || /casilla llena|buzon lleno|temporalmente/.test(hay);
  if(permanent) return 'BOUNCE_PERMANENT';
  if(temporary) return 'BOUNCE_TEMPORARY';
  return 'BOUNCE_TEMPORARY';
}

function extractBounceTargetEmail(text=''){
  const raw=String(text||'');
  const patterns=[
    /Final-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/i,
    /Original-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/i,
    /(?:to|recipient|destinatario)[:\s]+<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i,
  ];
  for(const re of patterns){ const m=raw.match(re); if(m?.[1]) return normalizeEmail(m[1]); }
  const emails=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(normalizeEmail).filter(Boolean);
  const institutional=normalizeEmail(GMAIL_USER || FACTORY_SUPPORT_EMAIL || '');
  return emails.find((e)=>e && e!==institutional) || '';
}

function looksLikeAutomaticMail(parsed, fromAddress=''){
  const headers=parsed?.headers;
  const autoSubmitted=String(headers?.get?.('auto-submitted') || '').toLowerCase();
  const precedence=String(headers?.get?.('precedence') || '').toLowerCase();
  const from=normalizeName(fromAddress || '');
  return (autoSubmitted && autoSubmitted!=='no') || ['bulk','junk','list'].includes(precedence) || /no reply|noreply|do not reply/.test(from);
}

async function findPortalUserByEmail(email=''){
  const normalized=normalizeEmail(email);
  if(!normalized) return null;
  let user=await prisma.user.findUnique({ where:{email:normalized}, include:{company:true} }).catch(()=>null);
  if(user) return user;
  const company=await prisma.companyProfile.findFirst({ where:{contactEmail:{equals:normalized,mode:'insensitive'}}, include:{user:true} }).catch(()=>null);
  return company?.user ? {...company.user,company} : null;
}

async function getOrCreateSupportThreadForInboundEmail(user, subject=''){
  if(!user) return null;
  const role=String(user.role||'').toUpperCase();
  if(role==='CANDIDATE'){
    const existing=await prisma.supportThread.findFirst({where:{userId:user.id,role:'CANDIDATE'},orderBy:{updatedAt:'desc'}}).catch(()=>null);
    return existing || prisma.supportThread.create({data:{role:'CANDIDATE',userId:user.id,subject:normalizeMailSubject(subject)||'Consulta por email candidato'}});
  }
  if(role==='COMPANY'){
    const company=user.company || await prisma.companyProfile.findUnique({where:{userId:user.id}}).catch(()=>null);
    if(!company) return null;
    const existing=await prisma.supportThread.findFirst({where:{companyId:company.id,role:'COMPANY'},orderBy:{updatedAt:'desc'}}).catch(()=>null);
    return existing || prisma.supportThread.create({data:{role:'COMPANY',companyId:company.id,userId:user.id,subject:normalizeMailSubject(subject)||`Consulta email ${company.companyName||'empresa'}`}});
  }
  return null;
}

async function suppressInvalidEmail(email, reason, sourceInboundMailId=null){
  const normalized=normalizeEmail(email);
  if(!normalized) return null;
  return prisma.emailSuppression.upsert({
    where:{email:normalized},
    create:{email:normalized,reason:clampText(reason||'Rebote definitivo',500),sourceInboundMailId,active:true},
    update:{reason:clampText(reason||'Rebote definitivo',500),sourceInboundMailId,active:true},
  }).catch(()=>null);
}

async function syncSupportMailbox({limit=250}={}){
  if(!gmailConfigured()) return {configured:false,scanned:0,imported:0,consultations:0,permanentBounces:0,temporaryBounces:0,automatic:0,other:0};
  await ensureSupportKnowledgeSeed();
  const knowledgeRows=await prisma.supportKnowledge.findMany({where:{isActive:true},orderBy:{updatedAt:'desc'},take:400}).catch(()=>[]);
  const counters={configured:true,scanned:0,imported:0,consultations:0,permanentBounces:0,temporaryBounces:0,automatic:0,other:0,suppressed:0};
  await withGmailInbox(async(client)=>{
    const total=Number(client.mailbox?.exists||0);
    if(!total) return;
    const start=Math.max(1,total-Math.max(20,Math.min(Number(limit)||250,500))+1);
    for await(const msg of client.fetch(`${start}:${total}`,{uid:true,envelope:true,internalDate:true,source:true})){
      counters.scanned++;
      const exists=await prisma.inboundMailMessage.findUnique({where:{mailbox_uid:{mailbox:MAILBOX_FOLDER,uid:Number(msg.uid)}}}).catch(()=>null);
      if(exists) continue;
      const parsed=await simpleParser(msg.source);
      const fromAddress=normalizeEmail(parsed.from?.value?.[0]?.address || msg.envelope?.from?.[0]?.address || '');
      const bodyText=String(parsed.text || '').trim().slice(0,60000);
      const subject=parsed.subject || msg.envelope?.subject || '(sin asunto)';
      const combined=`${subject}\n${bodyText}`;
      let category='OTHER', consultationStatus=null, matchedUserId=null, matchedRole=null, supportThreadId=null, bounceTargetEmail=null, hiddenFromTraceability=false;
      const isBounce=looksLikeBounceEnvelope(parsed,fromAddress);
      if(isBounce){
        category=classifyBounceKind(combined);
        bounceTargetEmail=extractBounceTargetEmail(combined);
        hiddenFromTraceability=true;
      } else if(looksLikeAutomaticMail(parsed,fromAddress)) {
        category='AUTOMATIC'; hiddenFromTraceability=true;
      } else {
        const user=await findPortalUserByEmail(fromAddress);
        if(user && ['CANDIDATE','COMPANY'].includes(String(user.role||'').toUpperCase())){
          category='CONSULTATION'; matchedUserId=user.id; matchedRole=String(user.role).toUpperCase();
          const thread=await getOrCreateSupportThreadForInboundEmail(user,subject);
          supportThreadId=thread?.id || null;
          const cls=classifySupportConsultationStatus(bodyText||subject,matchedRole,knowledgeRows);
          consultationStatus=cls.key;
          if(thread){
            const externalRef=`gmail:${MAILBOX_FOLDER}:${Number(msg.uid)}`;
            await prisma.supportMessage.create({data:{threadId:thread.id,actor:'USER',content:clampText(bodyText||subject,4000),source:'EMAIL',externalRef}}).catch(()=>null);
            await prisma.supportThread.update({where:{id:thread.id},data:{lastUserMessage:clampText(bodyText||subject,4000),needsHuman:true,status:'WAITING_OPERATOR'}}).catch(()=>null);
          }
        }
      }
      const stored=await prisma.inboundMailMessage.create({data:{
        mailbox:MAILBOX_FOLDER,uid:Number(msg.uid),messageId:parsed.messageId||null,fromAddress:fromAddress||null,fromName:parsed.from?.value?.[0]?.name||null,
        subject:clampText(subject,500),bodyText,receivedAt:parsed.date||msg.internalDate||new Date(),category,consultationStatus,matchedUserId,matchedRole,supportThreadId,bounceTargetEmail:bounceTargetEmail||null,hiddenFromTraceability
      }}).catch(()=>null);
      counters.imported++;
      if(category==='CONSULTATION') counters.consultations++;
      else if(category==='BOUNCE_PERMANENT'){
        counters.permanentBounces++;
        if(bounceTargetEmail){ const sup=await suppressInvalidEmail(bounceTargetEmail,'Rebote definitivo detectado por Gmail',stored?.id||null); if(sup)counters.suppressed++; }
      } else if(category==='BOUNCE_TEMPORARY') counters.temporaryBounces++;
      else if(category==='AUTOMATIC') counters.automatic++;
      else counters.other++;
    }
  });
  return counters;
}

function extractSupportName(message=''){
  const raw = String(message || '').trim();
  const patterns = [
    /(?:mi nombre es|me llamo|soy)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}){0,2})/i,
    /^(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,\s]+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})/i
  ];
  for(const re of patterns){
    const m = raw.match(re);
    if(m?.[1]){
      const clean = m[1].trim().split(/\s+/).slice(0,2).map((w)=> w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      if(clean) return clean;
    }
  }
  return '';
}

function isGreetingMessage(message=''){
  const hay = normalizeName(message);
  return ['hola','buen dia','buen dia equipo','buenas','buenas tardes','buenas noches','que tal','como va','buenas talente pyme'].some((g)=> hay === g || hay.startsWith(g + ' '));
}

function isInsultMessage(message=''){
  const hay = normalizeName(message);
  return ['idiota','pelotudo','pelotuda','boludo','boluda','imbecil','imbecilidad','inutil','estupido','forro','mierda'].some((w)=> hay.includes(normalizeName(w)));
}

function buildSupportClosing(needsHuman){
  return needsHuman
    ? 'Gracias por tu consulta. La conversación quedó disponible para revisión humana.'
    : 'Gracias por tu consulta.';
}

function buildRoleFallback(role){
  const scope = String(role || '').toUpperCase();
  if(scope === 'CANDIDATE'){
    return 'Puedo ayudarte con Mi Perfil, la presentación por voz o texto, carga de foto y CV, descarga de tu CV PDF, Mis Oportunidades y Mis Postulaciones. También puedo indicarte cómo completar el perfil por etapas y volver más adelante sin perder lo guardado.';
  }
  if(scope === 'COMPANY'){
    return 'Puedo ayudarte con Buscar Talento, filtros, texto libre, publicaciones, Mis Búsquedas, Mis Candidatos, planes de Factory, bonificaciones, checkout seguro externo y capacidad operativa.';
  }
  return 'Puedo ayudarte con el Panel General, Factory Admin, matriz comercial, bonificaciones, accesos especiales, estadísticas del sistema y chat operador.';
}

const SUPPORT_INTENTS = [
  {
    id: 'candidate-profile',
    scopes: ['GLOBAL','CANDIDATE'],
    patterns: [/como completo mi perfil/, /completo mi perfil/, /mi perfil/, /datos curriculares/, /revisa tu perfil/, /perfil curricular/],
    build: async (ctx) => {
      const progress = buildSupportCandidateCompleteness(ctx.candidate);
      const pending = progress.pending.length ? ` Hoy te conviene revisar: ${progress.pending.join(', ')}.` : ' Hoy tu perfil figura completo en todos los bloques principales.';
      return `Para completar Mi Perfil entrá al panel del candidato y recorré estos bloques: 1) Datos personales: DNI, teléfono, email, localidad y dirección. 2) Perfil laboral: área de trabajo, especialidad, experiencia y nivel educativo. 3) Pretensión económica y trayectoria: sueldo pretendido y último trabajo. 4) Resumen curricular: cargá observaciones claras y, si querés, subí el CV para que el sistema extraiga un resumen útil para las empresas. 5) Foto de perfil: podés tomarla con cámara o subir una imagen. Guardá los cambios y revisá la barra de avance y las luces de colores para detectar lo pendiente.${pending} Tu avance actual es ${progress.done}/${progress.total} bloques.`;
    }
  },
  {
    id: 'candidate-cv-photo',
    scopes: ['GLOBAL','CANDIDATE'],
    patterns: [/cargar cv/, /subir cv/, /curriculum/, /curriculo/, /foto/, /tomar foto/, /subir archivo/, /resumen curricular/],
    build: async () => 'En Mi Perfil podés dictar o escribir una presentación profesional, cargar una foto y procesar tu CV. El audio no queda guardado: se conserva el texto que vos revisás y aprobás. La foto se puede tomar con la cámara o subir desde el dispositivo. El CV se usa para extraer un resumen curricular; después podés descargar un CV PDF profesional con la información vigente de tu perfil.'
  },
  {
    id: 'candidate-opportunities',
    scopes: ['GLOBAL','CANDIDATE'],
    patterns: [/mis oportunidades/, /postular/, /postularme/, /mis postulaciones/, /eliminar postulacion/, /eliminar postulación/],
    build: async () => 'Desde Mis Oportunidades buscás avisos por palabra clave, empresa o categoría. Cuando un aviso te interesa, lo pasás a Mis Postulaciones. En Mis Postulaciones podés revisar empresa, puesto y fecha, y también eliminar la postulación si ya no querés seguir en ese proceso.'
  },
  {
    id: 'candidate-visibility',
    scopes: ['GLOBAL','CANDIDATE'],
    patterns: [/mejorar mi visibilidad/, /aparecer mejor/, /que me encuentren/, /como me encuentran/, /como me ven las empresas/],
    build: async (ctx) => {
      const progress = buildSupportCandidateCompleteness(ctx.candidate);
      return `Para mejorar tu visibilidad conviene completar el perfil al 100%, definir bien área y especialidad, cargar sueldo pretendido, describir el último trabajo, mantener observaciones con un resumen curricular claro y sumar una foto. El texto libre de las empresas revisa también resumen curricular, observaciones y último trabajo, así que cuanto más preciso sea ese contenido, más fácil será encontrarte. Hoy tenés ${progress.percent}% de completitud aproximada.`;
    }
  },
  {
    id: 'company-search-talent',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/buscar talento/, /filtros/, /texto libre/, /especialidad/, /instrumentacion/, /instrumentacion/, /maquina herramienta/, /máquina herramienta/],
    build: async () => 'Buscar Talento está organizado por filtros de texto libre, área de trabajo, localidad, nivel, especialidad, experiencia, educación, capacitación, trabajo actual, categoría de soldador, máquina o herramienta, instrumento o equipo, última actualización y orden. El texto libre no solo mira nombre o localidad: también revisa resumen curricular, observaciones, último trabajo, herramientas e instrumentación para ampliar las coincidencias útiles.'
  },
  {
    id: 'company-free-text',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/electrico/, /electrica/, /industrial/, /resumen curricular/, /observaciones/, /texto libre no encuentra/, /no encuentra/],
    build: async () => 'El texto libre de Buscar Talento busca en múltiples campos al mismo tiempo: nombre, apellido, DNI, localidad, área, especialidad, último trabajo, observaciones y resumen curricular. Por eso, términos como “industrial”, “eléctrico”, “instrumentación” o palabras técnicas del CV pueden devolver coincidencias aunque no estén en un único campo visible del formulario.'
  },
  {
    id: 'company-my-candidates',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/mis candidatos/, /pretension economica/, /pretensión económica/, /sueldo pretendido/, /sueldo/, /postulaciones recibidas/],
    build: async () => 'En Mis Candidatos ves los perfiles guardados o recibidos por postulación. Cada tarjeta muestra un resumen del candidato y la pretensión económica con formato contable, por ejemplo $2.000.000. Al abrir la ficha completa, el sistema controla la capacidad del plan si corresponde.'
  },
  {
    id: 'company-publish-jobs',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/publicar busqueda/, /publicar búsqueda/, /publicar aviso/, /mis busquedas/, /mis búsquedas/],
    build: async (ctx) => {
      const usage = ctx.usage;
      let balance = '';
      if(usage){
        balance = usage.fullAccess
          ? ' Tu empresa tiene acceso total vigente, así que no se descuenta cupo operativo mientras dure ese beneficio.'
          : ` Hoy tu saldo operativo muestra ${usage.remainingPublications} publicaciones disponibles y ${usage.remainingSearches} búsquedas o aperturas disponibles.`;
      }
      return `Desde Publicar Búsqueda cargás el puesto, la descripción, los requisitos y la localización del aviso. Al publicar, se descuenta una publicación del plan activo. Mis Búsquedas te permite revisar lo publicado, el estado de cada aviso y el consumo de capacidad.${balance}`;
    }
  },
  {
    id: 'company-factory-plans',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/factory/, /planes/, /pago seguro/, /pasarela/, /iva/, /bonificacion/, /bonificación/, /carrito/, /checkout/, /confirmar compra/],
    build: async (ctx) => {
      const usage = ctx.usage;
      let balance = '';
      if(usage){
        balance = usage.fullAccess
          ? ' Tu empresa tiene acceso total free vigente en este momento.'
          : ` Saldo actual: ${usage.remainingPublications} publicaciones disponibles y ${usage.remainingSearches} búsquedas o aperturas disponibles.`;
      }
      return `Factory administra la contratación por tiempo. Cada plan define días, cantidad de publicaciones y cantidad de búsquedas o aperturas. El precio publicado es sin IVA y el impuesto se suma al confirmar la compra. Cuando confirmás, Talento PyME crea un pedido interno y te redirige a un proveedor externo seguro; el pago solo se acredita cuando el proveedor lo confirma por webhook firmado.${balance}`;
    }
  },
  {
    id: 'company-credits',
    scopes: ['GLOBAL','COMPANY'],
    patterns: [/creditos/, /créditos/, /aperturas/, /abrir ficha/, /consumir/, /saldo/, /capacidad operativa/, /publicaciones disponibles/, /busquedas disponibles/, /búsquedas disponibles/],
    build: async (ctx) => {
      const usage = ctx.usage;
      if(!usage) return 'La capacidad operativa se consume en dos frentes: publicaciones de avisos y aperturas completas de fichas de candidatos. El sistema muestra el saldo restante desde Factory y desde los paneles comerciales.';
      if(usage.fullAccess){
        return `Tu empresa tiene acceso total vigente hasta ${supportDateTime(usage.fullAccessUntil)}. Mientras dure ese acceso, podés operar sin consumir cupos de publicaciones ni búsquedas.`;
      }
      return `Tu saldo operativo actual es: ${usage.remainingPublications} publicaciones disponibles sobre ${usage.totalPublications}, y ${usage.remainingSearches} búsquedas o aperturas disponibles sobre ${usage.totalSearches}. Ver resultados resumidos no consume cupo; lo que consume es publicar un aviso o abrir una ficha completa cuando corresponde.`;
    }
  },
  {
    id: 'company-factory-admin',
    scopes: ['GLOBAL','COMPANY','SUPERADMIN'],
    patterns: [/factory admin/, /matriz comercial/, /matriz de planes/, /bonificaciones/, /acceso total free/, /codigo especial/, /código especial/],
    build: async () => 'Factory Admin permite editar la matriz comercial completa: nombre del plan, días, publicaciones, búsquedas y precio sin IVA. También permite crear códigos de bonificación por porcentaje, generar accesos total free por empresa y revisar los códigos activos o ya usados. El acceso está restringido por alias, clave y empresa habilitada.'
  },
  {
    id: 'superadmin-panel',
    scopes: ['GLOBAL','SUPERADMIN'],
    patterns: [/panel general/, /administrador general/, /estadisticas/, /estadísticas/, /empresas registradas/, /candidatos registrados/, /chat operador/],
    build: async (ctx) => {
      const s = ctx.adminSummary;
      const summary = s ? ` Hoy el sistema registra ${s.candidateCount} candidatos, ${s.companyCount} empresas, ${s.jobsCount} búsquedas y ${s.threadCount} conversaciones en el centro de ayuda.` : '';
      return `El Panel General concentra la vista completa del sistema: estadísticas globales, listados recientes de candidatos y empresas, matriz comercial, Factory Admin, bonificaciones, accesos especiales y chat operador para intervenir manualmente en conversaciones.${summary}`;
    }
  },
  {
    id: 'support-chat',
    scopes: ['GLOBAL','CANDIDATE','COMPANY','SUPERADMIN'],
    patterns: [/chat/, /ayuda ia/, /operador/, /eliminar mensaje/, /borrar mensaje/, /fecha y hora/],
    build: async () => 'En Ayuda IA cada mensaje se guarda con fecha y hora. Podés borrar mensajes individuales o limpiar toda la conversación para no acumular historial. Cuando hace falta, el hilo queda visible para revisión del operador desde el Panel General, y las respuestas reutilizables pueden incorporarse al conocimiento interno.'
  },
  {
    id: 'general-login-admin',
    scopes: ['GLOBAL','COMPANY','SUPERADMIN'],
    patterns: [/talento pyme/, /acceso general/, /ingresar como administrador/, /factory admin/, /panel general acceso/],
    build: async () => 'El acceso general al Panel General se hace con el alias administrativo de Talento PyME y la clave definida en Render. Ese ingreso funciona tanto si elegís el lado candidato como el lado empresa en la pantalla inicial. Desde ese panel administrás la matriz comercial, las bonificaciones, los accesos especiales y el chat operador.'
  }
];

async function getTopKnowledgeMatches(message, scopes){
  const rows = await prisma.supportKnowledge.findMany({ where: { isActive: true, scope: { in: scopes } }, orderBy: { updatedAt: 'desc' }, take: 400 }).catch(() => []);
  const ranked = rows
    .map((row)=> ({ row, score: scoreKnowledgeMatch(message, row) }))
    .filter((item)=> item.score >= 3)
    .sort((a,b)=> b.score - a.score)
    .slice(0, 3);
  return ranked;
}

async function trySupportIntent(message, ctx){
  const role = String(ctx.role || '').toUpperCase();
  const hay = normalizeName(message);
  let best = null;
  let bestScore = 0;
  for(const intent of SUPPORT_INTENTS){
    if(!intent.scopes.includes('GLOBAL') && !intent.scopes.includes(role)) continue;
    let score = 0;
    for(const pattern of intent.patterns){
      if(pattern instanceof RegExp){ if(pattern.test(hay)) score += 4; }
      else if(normalizeName(pattern) && hay.includes(normalizeName(pattern))) score += 3;
    }
    if(score > bestScore){ bestScore = score; best = intent; }
  }
  if(best && bestScore > 0){
    return { intent: best.id, answer: await best.build(ctx, message), score: bestScore };
  }
  return null;
}

async function refreshSupportThreadState(threadId){
  const messages = await prisma.supportMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' }, take: 200 }).catch(() => []);
  let lastUser = null;
  let lastResponder = null;
  for(const m of messages){
    if(m.actor === 'USER') lastUser = m;
    if(['ASSISTANT','OPERATOR','SYSTEM'].includes(m.actor)) lastResponder = m;
  }
  const needsHuman = !!lastUser && (!lastResponder || new Date(lastResponder.createdAt) < new Date(lastUser.createdAt));
  const status = !messages.length ? 'OPEN' : (needsHuman ? 'WAITING_OPERATOR' : 'WAITING_USER');
  await prisma.supportThread.update({
    where: { id: threadId },
    data: {
      lastUserMessage: lastUser?.content || null,
      lastAiMessage: lastResponder?.content || null,
      needsHuman,
      status,
    }
  }).catch(() => null);
  const thread = await prisma.supportThread.findUnique({ where: { id: threadId } }).catch(() => null);
  return { messages, thread };
}

async function generateSupportAssistantReply(message, thread, req){
  await ensureSupportKnowledgeSeed();
  const ctx = await buildSupportContext(thread, req);
  const scope = ctx.role === 'COMPANY' ? ['GLOBAL','COMPANY'] : ctx.role === 'CANDIDATE' ? ['GLOBAL','CANDIDATE'] : ['GLOBAL','COMPANY','CANDIDATE','SUPERADMIN'];
  const personName = extractSupportName(message);
  const greeting = isGreetingMessage(message);
  const insulting = isInsultMessage(message);
  const hello = personName ? `Hola ${personName}. ` : (greeting ? 'Hola. ' : '');

  if(insulting){
    return {
      answer: `${hello}Puedo ayudarte mejor si mantenemos un trato respetuoso. Decime qué necesitás resolver en Talento PyME y te respondo con claridad. ${buildSupportClosing(false)}`.trim(),
      needsHuman: false,
      source: 'moderation'
    };
  }

  const intentMatch = await trySupportIntent(message, ctx);
  if(intentMatch){
    return {
      answer: `${hello}${intentMatch.answer} ${buildSupportClosing(false)}`.trim(),
      needsHuman: false,
      source: intentMatch.intent
    };
  }

  const rankedKnowledge = await getTopKnowledgeMatches(message, scope);
  if(rankedKnowledge.length){
    const primary = rankedKnowledge[0].row?.answer || '';
    const secondary = rankedKnowledge[1]?.row?.answer || '';
    const blended = secondary && normalizeName(secondary) !== normalizeName(primary)
      ? `${primary} ${secondary}`
      : primary;
    return {
      answer: `${hello}${blended} ${buildSupportClosing(false)}`.trim(),
      needsHuman: false,
      source: 'knowledge'
    };
  }

  if(greeting){
    return {
      answer: `${hello}${buildRoleFallback(ctx.role)} ${buildSupportClosing(false)}`.trim(),
      needsHuman: false,
      source: 'greeting'
    };
  }

  return {
    answer: `${hello}${buildRoleFallback(ctx.role)} ${buildSupportClosing(true)}`.trim(),
    needsHuman: true,
    source: 'fallback'
  };
}

async function getSupportSuggestionsByRole(role){
  const scope = String(role || '').toUpperCase();
  if(SUPPORT_SUGGESTIONS[scope]) return SUPPORT_SUGGESTIONS[scope];
  return SUPPORT_SUGGESTIONS.COMPANY;
}

async function getOrCreateSupportThreadForUser(req){
  if(req.user?.role === 'CANDIDATE'){
    const existing = await prisma.supportThread.findFirst({ where: { userId: req.user.id, role: 'CANDIDATE' }, orderBy: { updatedAt: 'desc' } }).catch(() => null);
    if(existing) return existing;
    return prisma.supportThread.create({ data: { role: 'CANDIDATE', userId: req.user.id, subject: 'Chat de ayuda candidato' } });
  }
  if(req.user?.id === VIRTUAL_ADMIN_USER_ID || ['ADMIN','SUPERADMIN'].includes(String(req.user?.role || '').toUpperCase())){
    const existing = await prisma.supportThread.findFirst({ where: { role: 'SUPERADMIN', subject: 'Chat interno admin' }, orderBy: { updatedAt: 'desc' } }).catch(() => null);
    if(existing) return existing;
    return prisma.supportThread.create({ data: { role: 'SUPERADMIN', subject: 'Chat interno admin' } });
  }
  const { company } = await getCompanyContextByUserId(req.user.id);
  const existing = await prisma.supportThread.findFirst({ where: { companyId: company.id, role: 'COMPANY' }, orderBy: { updatedAt: 'desc' } }).catch(() => null);
  if(existing) return existing;
  return prisma.supportThread.create({ data: { role: 'COMPANY', companyId: company.id, userId: req.user.id, subject: `Chat empresa ${company.companyName || 'Empresa'}` } });
}

app.get('/support/bootstrap', auth, async (req, res) => {
  try {
    const thread = await getOrCreateSupportThreadForUser(req);
    const refreshed = await refreshSupportThreadState(thread.id);
    const suggested = await getSupportSuggestionsByRole(refreshed.thread?.role || thread.role);
    return res.json({ ok: true, thread: refreshed.thread || thread, messages: refreshed.messages || [], suggested, supportEmail: FACTORY_SUPPORT_EMAIL });
  } catch (err) {
    console.error('GET /support/bootstrap', err);
    return res.status(500).json({ error: 'No se pudo abrir el chat de ayuda.' });
  }
});

app.post('/support/message', auth, async (req, res) => {
  try {
    const content = clampText(String(req.body?.content || ''), 4000);
    if(!content) return res.status(400).json({ error: 'Escribí tu consulta para continuar.' });
    const thread = await getOrCreateSupportThreadForUser(req);
    await prisma.supportMessage.create({ data: { threadId: thread.id, actor: 'USER', content } });
    const ai = await generateSupportAssistantReply(content, thread, req);
    await prisma.supportMessage.create({ data: { threadId: thread.id, actor: 'ASSISTANT', content: ai.answer } });
    await prisma.supportThread.update({ where: { id: thread.id }, data: { lastUserMessage: content, lastAiMessage: ai.answer, needsHuman: !!ai.needsHuman, status: ai.needsHuman ? 'WAITING_OPERATOR' : 'WAITING_USER' } }).catch(() => null);
    const refreshed = await refreshSupportThreadState(thread.id);
    return res.json({ ok: true, threadId: thread.id, messages: refreshed.messages || [], thread: refreshed.thread || thread, needsHuman: !!ai.needsHuman });
  } catch (err) {
    console.error('POST /support/message', err);
    return res.status(500).json({ error: 'No se pudo enviar la consulta.' });
  }
});

app.delete('/support/messages/:id', auth, async (req, res) => {
  try {
    const thread = await getOrCreateSupportThreadForUser(req);
    const msg = await prisma.supportMessage.findUnique({ where: { id: String(req.params.id || '') } }).catch(() => null);
    if(!msg || msg.threadId !== thread.id) return res.status(404).json({ error: 'Mensaje no encontrado.' });
    await prisma.supportMessage.delete({ where: { id: msg.id } }).catch(() => null);
    const refreshed = await refreshSupportThreadState(thread.id);
    return res.json({ ok: true, messages: refreshed.messages || [], thread: refreshed.thread || thread });
  } catch (err) {
    console.error('DELETE /support/messages/:id', err);
    return res.status(500).json({ error: 'No se pudo eliminar el mensaje.' });
  }
});

app.delete('/support/thread', auth, async (req, res) => {
  try {
    const thread = await getOrCreateSupportThreadForUser(req);
    await prisma.supportMessage.deleteMany({ where: { threadId: thread.id } }).catch(() => null);
    await prisma.supportThread.update({ where: { id: thread.id }, data: { lastUserMessage: null, lastAiMessage: null, needsHuman: false, status: 'OPEN' } }).catch(() => null);
    return res.json({ ok: true, messages: [], thread: { ...(thread || {}), lastUserMessage: null, lastAiMessage: null, needsHuman: false, status: 'OPEN' } });
  } catch (err) {
    console.error('DELETE /support/thread', err);
    return res.status(500).json({ error: 'No se pudo limpiar la conversación.' });
  }
});

async function readDatabaseCapacityStatus(){
  const backupInfo = await readBackupOperationalSummary().catch(() => ({ recentBackups: [] }));
  const fallback = {
    provider: detectDatabaseProvider().name,
    dbName: 'principal',
    sizeBytes: 0,
    sizeMb: 0,
    warningMb: ADMIN_DB_WARNING_MB,
    criticalMb: ADMIN_DB_CRITICAL_MB,
    usagePct: 0,
    candidateCount: 0,
    estimatedCandidateCapacity: 0,
    candidateCapacityPct: 0,
    safeStorageMb: Number((ADMIN_DB_CRITICAL_MB * 0.8).toFixed(2)),
    status: 'UNKNOWN',
    statusLabel: 'Sin lectura',
    headline: 'No se pudo leer el tamaño actual de la base.',
    recommendation: 'Verificá el proveedor de base de datos y configurá los umbrales de capacidad para dejar este tablero operativo.',
    infraUrl: ADMIN_INFRA_URL || null,
    backupUrl: ADMIN_BACKUP_URL || null,
    backupMode: ADMIN_BACKUP_MODE || 'AUTOMATIC',
    backupLabel: adminBackupModeLabel(ADMIN_BACKUP_MODE),
    backupSummary: buildAdminBackupSummary(),
    backupFrequency: ADMIN_BACKUP_FREQUENCY,
    backupFrequencyLabel: adminBackupFrequencyLabel(ADMIN_BACKUP_FREQUENCY),
    backupRetentionDays: ADMIN_BACKUP_RETENTION_DAYS,
    backupProvider: ADMIN_BACKUP_PROVIDER,
    backupProviderLabel: adminBackupProviderLabel(ADMIN_BACKUP_PROVIDER),
    upgradeUrl: ADMIN_UPGRADE_URL || ADMIN_INFRA_URL || detectDatabaseProvider().consoleUrl || guessProviderConsoleUrl('principal') || null,
    providerLoginNote: 'El enlace abre la consola del proveedor y puede pedir su propio acceso de infraestructura.',
    ...backupInfo,
  };
  try {
    const [rows,candidateCountRaw] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT current_database() AS db_name, pg_database_size(current_database()) AS size_bytes`),
      prisma.candidateBolsa.count().catch(()=>0),
    ]);
    const row = Array.isArray(rows) ? rows[0] || {} : {};
    const sizeBytes = Number(row?.size_bytes || 0);
    const sizeMb = Number((sizeBytes / (1024 * 1024)).toFixed(2));
    const candidateCount = Number(candidateCountRaw || 0);
    const safeStorageMb = Number((ADMIN_DB_CRITICAL_MB * 0.8).toFixed(2));
    const avgMbPerCandidate = candidateCount > 0 && sizeMb > 0 ? sizeMb / candidateCount : 0;
    const estimatedCandidateCapacity = avgMbPerCandidate > 0 ? Math.max(candidateCount, Math.floor(safeStorageMb / avgMbPerCandidate)) : 0;
    const candidateCapacityPct = estimatedCandidateCapacity > 0 ? Number(((candidateCount / estimatedCandidateCapacity) * 100).toFixed(1)) : 0;
    const usagePct = candidateCapacityPct;
    let status = 'OK';
    let statusLabel = 'Operativo';
    let headline = 'La capacidad estimada para candidatos se encuentra en un rango saludable.';
    let recommendation = estimatedCandidateCapacity ? `Con ${candidateCount.toLocaleString('es-AR')} candidatos, el sistema usa aproximadamente ${candidateCapacityPct.toLocaleString('es-AR')}% de una capacidad operativa segura estimada en ${estimatedCandidateCapacity.toLocaleString('es-AR')} candidatos, calculada con el peso real actual de la base y una reserva del 20%.` : 'Seguí monitoreando este tablero y revisá periódicamente la evolución del tamaño de la base.';
    if (candidateCapacityPct >= 90 || sizeMb >= ADMIN_DB_CRITICAL_MB) {
      status = 'CRITICAL';
      statusLabel = 'Crítico';
      headline = 'La base está muy cerca de la capacidad operativa segura estimada.';
      recommendation = 'Conviene ampliar capacidad antes de incorporar un volumen importante de nuevos candidatos.';
    } else if (candidateCapacityPct >= 70 || sizeMb >= safeStorageMb) {
      status = 'WARNING';
      statusLabel = 'Atención';
      headline = 'La base está entrando en una zona preventiva de capacidad.';
      recommendation = 'Revisá la consola del proveedor y planificá la ampliación antes de superar el 90% de la capacidad segura estimada.';
    }
    if (backupInfo.lastBlockedBackupAt) {
      status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
      statusLabel = status === 'CRITICAL' ? 'Crítico' : 'Atención';
      recommendation = 'Se bloqueó un backup por caída brusca de peso o registros. Se conserva el último backup confiable y conviene auditar la base antes de seguir.';
    } else if (backupInfo.backupOverdue) {
      status = status === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
      statusLabel = status === 'CRITICAL' ? 'Crítico' : 'Atención';
      recommendation = 'El backup automático está vencido o sin ejecución reciente. Revisá el resguardo lógico y el respaldo del proveedor.';
    }
    return {
      ...fallback,
      dbName: String(row?.db_name || 'principal'),
      sizeBytes,
      sizeMb,
      usagePct,
      candidateCount,
      estimatedCandidateCapacity,
      candidateCapacityPct,
      safeStorageMb,
      avgMbPerCandidate:Number(avgMbPerCandidate.toFixed(4)),
      status,
      statusLabel,
      headline,
      recommendation,
      provider: detectDatabaseProvider().name,
      upgradeUrl: ADMIN_UPGRADE_URL || ADMIN_INFRA_URL || detectDatabaseProvider().consoleUrl || guessProviderConsoleUrl(String(row?.db_name || 'principal')) || null,
    };
  } catch (error) {
    console.error('readDatabaseCapacityStatus', error);
    return fallback;
  }
}

async function ensureMonthlyAuditSnapshots({ monthKeys = [], candidateMonthMap = new Map(), companyMonthMap = new Map(), billingMonthMap = new Map(), currentMonthKey = null }) {
  if (!Array.isArray(monthKeys) || !monthKeys.length) return [];
  const payloads = monthKeys.map((key) => ({
    monthKey: key,
    year: Number(String(key).slice(0, 4)),
    month: Number(String(key).slice(5, 7)),
    candidateCount: Number(candidateMonthMap.get(key) || 0),
    companyCount: Number(companyMonthMap.get(key) || 0),
    billingCount: Number(billingMonthMap.get(key) || 0),
    source: key === currentMonthKey ? 'LIVE_OPEN' : 'LIVE_CLOSED',
    closedAt: key === currentMonthKey ? null : new Date(),
  }));
  const closedPayloads = payloads.filter((item) => item.monthKey !== currentMonthKey);
  if (closedPayloads.length) {
    await prisma.adminMonthlySnapshot.createMany({ data: closedPayloads, skipDuplicates: true }).catch(() => null);
  }
  const currentPayload = payloads.find((item) => item.monthKey === currentMonthKey);
  if (currentPayload) {
    await prisma.adminMonthlySnapshot.upsert({
      where: { monthKey: currentPayload.monthKey },
      update: {
        candidateCount: currentPayload.candidateCount,
        companyCount: currentPayload.companyCount,
        billingCount: currentPayload.billingCount,
        source: currentPayload.source,
        closedAt: null,
      },
      create: currentPayload,
    }).catch(() => null);
  }
  return prisma.adminMonthlySnapshot.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }] }).catch(() => []);
}

function mergeOperationalSeriesWithSnapshots({ monthKeys = [], liveCandidateMap = new Map(), liveCompanyMap = new Map(), liveBillingMap = new Map(), snapshots = [], currentMonthKey = null, monthLabel }) {
  const snapshotMap = new Map((snapshots || []).map((row) => [row.monthKey, row]));
  return monthKeys.map((key) => {
    const snapshot = snapshotMap.get(key);
    const useSnapshot = snapshot && key !== currentMonthKey;
    return {
      key,
      label: monthLabel(key, 'long'),
      shortLabel: monthLabel(key, 'short'),
      candidates: Number(useSnapshot ? snapshot.candidateCount : (liveCandidateMap.get(key) || 0)),
      companies: Number(useSnapshot ? snapshot.companyCount : (liveCompanyMap.get(key) || 0)),
      billing: Number(useSnapshot ? snapshot.billingCount : (liveBillingMap.get(key) || 0)),
      source: useSnapshot ? 'SNAPSHOT' : 'LIVE',
    };
  });
}


const ADMIN_COMPANY_CATEGORY_LABELS = {
  FABRICACION: 'Fabricación',
  LOGISTICA: 'Logística',
  SERVICIO: 'Servicio',
};

const ADMIN_CANDIDATE_CLASS_LABELS = {
  APRENDIZ: 'Aprendices',
  PASANTE: 'Pasantes / Formación superior',
  OPERATIVO: 'Operativos / Oficios',
  TECNICO: 'Técnicos / Especialistas',
  SUPERVISION: 'Supervisión / Jefaturas',
  PROFESIONAL: 'Profesionales / Ingeniería',
  GERENCIAL: 'Gerencia / Dirección',
  ADMINISTRATIVO: 'Administrativos / Gestión',
};

const SUPPORT_DETAIL_SEGMENT_KEY = 'SUPPORT_DETAIL_PENDING';
const SUPPORT_DETAIL_SEGMENT_LABEL = 'Candidatos con consultas pendientes · App + Email';
const SUPPORT_DETAIL_RECIPIENT_MODES = ['SUPPORT_DETAIL_UNSENT_ONLY','SUPPORT_DETAIL_ALL_ELIGIBLE'];

async function listSupportDetailRecipients(){
  const messages = await prisma.supportMessage.findMany({
    where:{ actor:'USER', thread:{ is:{ role:'CANDIDATE', userId:{ not:null } } } },
    select:{ id:true, content:true, source:true, externalRef:true, createdAt:true, thread:{ select:{ userId:true } } },
    orderBy:{ createdAt:'asc' },
  });
  const latestQuestionByUser = new Map();
  for(const row of messages){
    const userId=row.thread?.userId;
    if(!userId) continue;
    const at=new Date(row.createdAt);
    const prev=latestQuestionByUser.get(userId);
    if(!prev || at>prev) latestQuestionByUser.set(userId,at);
  }
  if(!latestQuestionByUser.size) return { recipients:[], totalAccounts:0, optedOut:0, duplicates:0, reachable:0, questionCount:0, coveredQuestionCount:0, newQuestionCount:0 };

  const coveredRows = await prisma.adminCommunicationRecipient.findMany({
    where:{
      userId:{ in:[...latestQuestionByUser.keys()] },
      status:{ in:['PENDING','SENT'] },
      communication:{ is:{ recipientMode:{ in:SUPPORT_DETAIL_RECIPIENT_MODES } } },
    },
    select:{ userId:true, communication:{ select:{ createdAt:true } } },
  });
  const coveredAtByUser=new Map();
  for(const row of coveredRows){
    const at=new Date(row.communication?.createdAt || 0);
    const prev=coveredAtByUser.get(row.userId);
    if(!prev || at>prev) coveredAtByUser.set(row.userId,at);
  }
  const pendingUserIds=[...latestQuestionByUser.entries()]
    .filter(([userId,lastQuestionAt])=>!coveredAtByUser.get(userId) || lastQuestionAt>coveredAtByUser.get(userId))
    .map(([userId])=>userId);
  if(!pendingUserIds.length) return { recipients:[], totalAccounts:0, optedOut:0, duplicates:0, reachable:0, questionCount:0, coveredQuestionCount:0, newQuestionCount:0 };

  const users=await prisma.user.findMany({
    where:{ id:{ in:pendingUserIds }, role:'CANDIDATE' },
    select:{ id:true,email:true,bulkEmailOptOutAt:true },
    orderBy:{ createdAt:'asc' },
  });
  const grouped=new Map();
  for(const user of users){
    const email=normalizeEmail(user.email);
    if(!email) continue;
    const row={ userId:user.id, email, optedOut:Boolean(user.bulkEmailOptOutAt) };
    const prev=grouped.get(email);
    grouped.set(email, prev ? { ...prev, optedOut:Boolean(prev.optedOut || row.optedOut) } : row);
  }
  const all=[...grouped.values()];
  const suppressions=all.length ? await prisma.emailSuppression.findMany({where:{active:true,email:{in:all.map((r)=>r.email)}},select:{email:true}}).catch(()=>[]) : [];
  const suppressedSet=new Set(suppressions.map((r)=>normalizeEmail(r.email)));
  // Sólo contamos preguntas posteriores a la última guía enviada/programada a cada candidato.
  // Así una consulta ya atendida desaparece de la bandeja y vuelve a aparecer sólo si hay una pregunta nueva.
  const pendingMessages=messages.filter((row)=>{
    const userId=row.thread?.userId;
    if(!pendingUserIds.includes(userId)) return false;
    const coveredAt=coveredAtByUser.get(userId);
    return !coveredAt || new Date(row.createdAt)>coveredAt;
  });
  const knowledgeRows=await prisma.supportKnowledge.findMany({ where:{ isActive:true }, orderBy:{ updatedAt:'desc' }, take:400 }).catch(()=>[]);
  let coveredQuestionCount=0;
  let newQuestionCount=0;
  let appQuestionCount=0;
  let emailQuestionCount=0;
  for(const row of pendingMessages){
    const cls=classifySupportConsultationStatus(row.content || '', 'CANDIDATE', knowledgeRows);
    if(cls.key==='COVERED') coveredQuestionCount++; else newQuestionCount++;
    if(String(row.source||'APP').toUpperCase()==='EMAIL') emailQuestionCount++; else appQuestionCount++;
  }
  return {
    recipients:all.filter((r)=>!r.optedOut && !suppressedSet.has(r.email)),
    totalAccounts:users.length,
    optedOut:all.filter((r)=>r.optedOut).length,
    suppressed:all.filter((r)=>suppressedSet.has(r.email)).length,
    duplicates:Math.max(0,users.length-all.length),
    reachable:all.length,
    questionCount:pendingMessages.length,
    coveredQuestionCount,
    newQuestionCount,
    appQuestionCount,
    emailQuestionCount,
    pendingMessages,
  };
}

function supportDetailTopicKey(text=''){
  const t=normalizeName(text);
  if(/foto|camara|cámara|sacar.*foto|cargar.*foto/.test(t)) return 'PHOTO';
  if(/subir.*cv|cargar.*cv|formato.*cv|curriculum|currículo|archivo.*pdf|docx|txt/.test(t)) return 'CV';
  if(/complet.*perfil|terminar.*perfil|celdas|datos personales|observaciones|alcance curricular/.test(t)) return 'PROFILE';
  if(/visibilidad|que me encuentren|encontrado por empresas|palabras clave/.test(t)) return 'VISIBILITY';
  if(/postular|postulacion|postulación|expo empleo/.test(t)) return 'APPLICATION';
  if(/mis oportunidades|no sale nada|no encuentro puesto|busco supervisor|busqueda|búsqueda/.test(t)) return 'SEARCH';
  if(/actualizar.*perfil|sin perder informacion|sin perder información/.test(t)) return 'UPDATE';
  return 'OTHER';
}

const SUPPORT_DETAIL_SECTIONS = {
  PROFILE:{ title:'Cómo completar o mejorar Mi Perfil', body:'Entrá a Mi Perfil y avanzá por las etapas con la información que tengas. En el punto 2 podés escribir con tus propias palabras o contárselo a la IA: qué sabés hacer, qué tareas realizaste, qué te gustaría aprender y en qué tipo de trabajo te gustaría desempeñarte. No hace falta redactarlo de manera profesional: la función “Corrección IA profesional” ordena el relato, elimina repeticiones y mejora la presentación sin inventar antecedentes. Después revisá el resultado, corregí lo que quieras y guardalo.' },
  PHOTO:{ title:'Cómo cargar o sacar tu foto', body:'En Mi Perfil buscá la sección Foto de perfil. Podés seleccionar una imagen que ya tengas en el teléfono o la computadora y, cuando el dispositivo lo permita, usar la cámara. Elegí una foto reciente, de frente, con buena luz, fondo simple y sin filtros fuertes. Una vez seleccionada, confirmá la carga y guardá los cambios. Si usás celular y no aparece la cámara, revisá que el navegador tenga permiso para acceder a ella.' },
  CV:{ title:'Cómo cargar el CV y qué formatos acepta', body:'En Mi Perfil buscá la sección de CV y elegí el archivo desde tu dispositivo. Talento PyME admite PDF, DOCX y TXT. El sistema lee el contenido para enriquecer el perfil; no necesitás que el diseño sea perfecto. Después de cargarlo, volvé al punto 2 y usá “Corrección IA profesional” para integrar lo que contaste con los antecedentes del CV. Finalmente revisá y guardá. Si el archivo no carga, verificá que sea uno de esos formatos y probá nuevamente desde el archivo original, no desde una vista previa o una imagen del documento.' },
  VISIBILITY:{ title:'Cómo mejorar tu visibilidad para las empresas', body:'Las empresas encuentran candidatos por palabras relacionadas con oficio, especialidad, experiencia, estudios y tareas. Por eso conviene escribir de manera concreta qué sabés hacer. Por ejemplo: electricidad domiciliaria, mantenimiento mecánico, atención al cliente, cocina, depósito, control de stock, limpieza, cuidado de personas, soldadura o administración. También indicá qué actividad te interesa aprender o desarrollar. Cuanto más específico sea el perfil, más posibilidades hay de aparecer en una búsqueda adecuada.' },
  SEARCH:{ title:'Cómo buscar oportunidades y qué significa si no aparecen resultados', body:'Entrá en Mis Oportunidades y buscá por palabras simples relacionadas con el puesto o el área: por ejemplo seguridad e higiene, supervisor, logística, mantenimiento o producción. Si una búsqueda devuelve cero resultados, no significa que tu perfil esté mal: puede ocurrir que en ese momento no haya una publicación activa con esas palabras. Probá términos más amplios y volvé a consultar periódicamente.' },
  APPLICATION:{ title:'Cómo postularte a una oportunidad', body:'Cuando encuentres una búsqueda que te interese, abrila y utilizá la opción de postulación. Después podés revisar lo enviado desde Mis Postulaciones. Antes de postularte conviene tener actualizado Mi Perfil, especialmente la presentación del punto 2, experiencia, formación y datos de contacto, porque esa es la información que ayuda a la empresa a interpretar mejor tu candidatura.' },
  UPDATE:{ title:'Cómo actualizar tu perfil sin perder lo anterior', body:'Podés volver a Mi Perfil todas las veces que necesites. Modificá sólo la información que quieras cambiar y guardá. La actualización no exige volver a empezar: podés agregar una experiencia, corregir una descripción, incorporar estudios, cargar una nueva foto o reemplazar el CV. Antes de salir, verificá que el cambio haya quedado guardado.' },
  OTHER:{ title:'Si tu consulta no está dentro de estos ejemplos', body:'Volvé a Ayuda IA y escribí la consulta con la mayor precisión posible, indicando en qué pantalla estás y qué querés lograr. Si aparece un error, explicá qué botón tocaste y qué ocurrió. Esa información permite orientar mejor la respuesta y también ayuda a mejorar las próximas explicaciones del sistema.' },
};

async function buildSupportDetailGuide(){
  const recipientData=await listSupportDetailRecipients();
  const rows=Array.isArray(recipientData.pendingMessages) ? recipientData.pendingMessages : [];
  const topicKeys=[];
  const seen=new Set();
  for(const row of rows){
    const key=supportDetailTopicKey(row.content || '');
    if(!seen.has(key)){ seen.add(key); topicKeys.push(key); }
  }
  if(!topicKeys.length) topicKeys.push('PROFILE','CV','PHOTO','VISIBILITY','SEARCH','APPLICATION');
  const intro=[
    'Hola,',
    '',
    'Registramos una o más consultas tuyas a través de Ayuda IA o del correo de Talento PyME. Para facilitarte el proceso, reunimos en este único correo una respuesta general y ordenada sobre los temas consultados, evitando enviarte varios mensajes separados.',
    '',
    'No significa que hayas hecho algo mal. La idea es que puedas aprovechar mejor el portal, completar tu perfil con mayor claridad y aumentar las posibilidades de ser encontrado por una empresa.',
    ''
  ];
  const body=[...intro];
  let n=1;
  for(const key of topicKeys){
    const sec=SUPPORT_DETAIL_SECTIONS[key] || SUPPORT_DETAIL_SECTIONS.OTHER;
    body.push(`${n}) ${sec.title}`,sec.body,''); n++;
  }
  body.push('IMPORTANTE','Si todavía te quedó alguna duda, podés volver a Ayuda IA y formular la consulta con tus propias palabras. También podés escribir o dictar en el punto 2 de Mi Perfil lo que sabés hacer o te gustaría hacer: la IA te ayuda a ordenarlo y redactarlo de una manera más profesional.','', 'Nuestro objetivo es que la falta de experiencia para redactar un currículum no sea un obstáculo para mostrar lo que realmente sabés hacer.','', 'Talento PyME','Conectando experiencia con producción.');
  return {
    subject:'Talento PyME · Guía ampliada para completar y aprovechar mejor tu perfil',
    body:body.join('\n'),
    topicKeys,
    questionCount:rows.length,
    recipientCount:recipientData.recipients.length,
    coveredQuestionCount:Number(recipientData.coveredQuestionCount||0),
    newQuestionCount:Number(recipientData.newQuestionCount||0),
    appQuestionCount:Number(recipientData.appQuestionCount||0),
    emailQuestionCount:Number(recipientData.emailQuestionCount||0),
  };
}

const ADMIN_EXPERTISE_LABELS = {
  MECANICA: 'Mecánica',
  ELECTRICA: 'Eléctrica',
  PRODUCCION: 'Producción / Operaciones',
  MANTENIMIENTO: 'Mantenimiento',
  SOLDADURA_MONTAJE: 'Soldadura / Montaje / Calderería',
  INSTRUMENTACION: 'Instrumentación / Automatización',
  INGENIERIA: 'Ingeniería / Oficina técnica',
  CONSTRUCCION: 'Construcción / Obra industrial',
  PLANIFICACION: 'Planificación / Costos',
  CALIDAD_HSE: 'Calidad / HSE',
  LOGISTICA: 'Logística / Transporte / Comex',
  ADMINISTRACION: 'Administración',
  RRHH: 'Recursos Humanos',
  FINANZAS: 'Finanzas / Contabilidad',
  COMERCIAL: 'Comercial / Ventas / Atención al cliente',
  COMPRAS: 'Compras / Abastecimiento',
  SEGURIDAD: 'Seguridad / Vigilancia',
  LIMPIEZA: 'Limpieza / Maestranza',
  GASTRONOMIA: 'Gastronomía / Catering',
  SALUD: 'Salud / Emergencias',
  CUIDADOS: 'Cuidados / Asistencia personal',
  SERVICIOS_PERSONALES: 'Servicios personales',
  EDUCACION: 'Educación / Capacitación',
  AMBIENTE: 'Sustentabilidad / Medio ambiente',
  IT: 'IT / Software',
  ELECTROMECANICA: 'Electromecánica',
  ELECTRONICA: 'Electrónica',
  QUIMICA: 'Química',
  INDUSTRIAL: 'Industrial / Procesos',
  METALURGIA: 'Metalurgia',
  LABORATORIO: 'Laboratorio / Ensayos',
  ENERGIA: 'Energía / Utilities',
  PROYECTOS: 'Proyectos / Project Management',
  GENERAL: 'Perfil general / Expertise no determinado',
};

function buildCandidateDirectoryFilterOptions(items = []){
  return Object.entries(ADMIN_CANDIDATE_CLASS_LABELS).map(([classKey, classLabel]) => {
    const classItems = (items || []).filter((item) => String(item.classKey || '') === classKey);
    const profileMap = new Map();
    for(const item of classItems){
      const key = String(item.expertiseKey || 'GENERAL');
      const current = profileMap.get(key) || { key, label:item.expertiseLabel || ADMIN_EXPERTISE_LABELS.GENERAL, count:0 };
      current.count += 1;
      profileMap.set(key, current);
    }
    return {
      key:classKey,
      label:classLabel,
      count:classItems.length,
      profiles:[...profileMap.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es')),
    };
  }).filter((group) => group.count > 0);
}
function filterCandidateDirectoryItems(items = [], token = 'ALL'){
  const raw = String(token || 'ALL').trim();
  if(!raw || raw === 'ALL') return items;
  const parts = raw.split('::');
  if(parts[0] === 'CLASS' && parts[1]) return items.filter((item) => String(item.classKey || '') === parts[1]);
  if(parts[0] === 'PROFILE' && parts[1] && parts[2]) return items.filter((item) => String(item.classKey || '') === parts[1] && String(item.expertiseKey || '') === parts[2]);
  return items;
}
function candidateDirectoryFilterLabel(options = [], token = 'ALL'){
  const raw = String(token || 'ALL').trim();
  if(!raw || raw === 'ALL') return '';
  const parts = raw.split('::');
  const group = options.find((item) => String(item.key || '') === String(parts[1] || ''));
  if(!group) return '';
  if(parts[0] === 'CLASS') return group.label;
  if(parts[0] === 'PROFILE'){
    const profile = (group.profiles || []).find((item) => String(item.key || '') === String(parts[2] || ''));
    return profile ? `${group.label} · ${profile.label}` : group.label;
  }
  return '';
}
function buildCompanyDirectoryFilterOptions(items = []){
  return Object.entries(ADMIN_COMPANY_CATEGORY_LABELS).map(([categoryKey, categoryLabel]) => {
    const familyItems = (items || []).filter((item) => String(item.categoryKey || '') === categoryKey);
    const profileMap = new Map();
    for(const item of familyItems){
      const key = String(item.activityKey || 'ACTIVIDAD_NO_ESPECIFICADA');
      const current = profileMap.get(key) || { key, label:item.activityLabel || 'Actividad principal no especificada', count:0 };
      current.count += 1;
      profileMap.set(key, current);
    }
    return {
      key:categoryKey,
      label:categoryLabel,
      count:familyItems.length,
      profiles:[...profileMap.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es')),
    };
  }).filter((group) => group.count > 0);
}
function filterCompanyDirectoryItems(items = [], token = 'ALL'){
  const raw = String(token || 'ALL').trim();
  if(!raw || raw === 'ALL') return items;
  const parts = raw.split('::');
  if(parts[0] === 'FAMILY' && parts[1]) return items.filter((item) => String(item.categoryKey || '') === parts[1]);
  if(parts[0] === 'PROFILE' && parts[1] && parts[2]) return items.filter((item) => String(item.categoryKey || '') === parts[1] && String(item.activityKey || '') === parts[2]);
  return items;
}
function companyDirectoryFilterLabel(options = [], token = 'ALL'){
  const raw = String(token || 'ALL').trim();
  if(!raw || raw === 'ALL') return '';
  const parts = raw.split('::');
  const group = options.find((item) => String(item.key || '') === String(parts[1] || ''));
  if(!group) return '';
  if(parts[0] === 'FAMILY') return group.label;
  if(parts[0] === 'PROFILE'){
    const profile = (group.profiles || []).find((item) => String(item.key || '') === String(parts[2] || ''));
    return profile ? `${group.label} · ${profile.label}` : group.label;
  }
  return '';
}

function adminNormText(value = ''){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function adminTitleCase(value = ''){
  return String(value || '').trim().replace(/\s+/g, ' ').split(' ').map((part) => {
    if(!part) return '';
    const upper = ['IT','HSE','QA','QC','RRHH','RR.HH.','PLC','SCADA','DCS','CAD','BIM','COMEX'];
    if(upper.includes(part.toUpperCase())) return part.toUpperCase().replace('RRHH','RR.HH.');
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ');
}

function adminDynamicKey(prefix, label){
  const slug = adminNormText(label).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56) || 'GENERAL';
  return `${prefix}_${slug}`;
}

function countAdminKeywords(text, words = []){
  const normalized = ` ${adminNormText(text)} `;
  return words.reduce((score, word) => score + (normalized.includes(adminNormText(word)) ? 1 : 0), 0);
}
function adminSearchTextMatch(text, query = ''){
  const q = adminNormText(query);
  if(!q) return true;
  const haystack = ` ${adminNormText(text)} `;
  const tokens = q.split(' ').filter(Boolean);
  return tokens.length ? tokens.every((token) => haystack.includes(token)) : true;
}

const ADMIN_COMPANY_ACTIVITY_RULES = [
  { key:'METALURGIA', label:'Metalurgia / Mecanizado', family:'FABRICACION', words:['metalurgica','metalurgico','mecanizado','mecanica industrial','caldereria','fundicion','acero','siderurg'] },
  { key:'AUTOMOTRIZ', label:'Automotriz / Autopartes', family:'FABRICACION', words:['automotriz','autopart','vehiculos','terminal automotriz'] },
  { key:'QUIMICA', label:'Química / Petroquímica', family:'FABRICACION', words:['quimica','petroquim','quimico','refineria'] },
  { key:'ALIMENTOS', label:'Alimentos / Bebidas', family:'FABRICACION', words:['alimenticia','alimentos','bebidas','food','frigorifico'] },
  { key:'PLASTICOS_ENVASES', label:'Plásticos / Envases', family:'FABRICACION', words:['plastico','plasticos','envases','packaging'] },
  { key:'EQUIPOS_MAQUINARIA', label:'Equipos / Maquinaria industrial', family:'FABRICACION', words:['maquinaria','equipos industriales','fabricacion de equipos','taller industrial'] },
  { key:'TRANSPORTE', label:'Transporte / Distribución', family:'LOGISTICA', words:['transporte','distribucion','flete','ruteo','camiones','ultima milla'] },
  { key:'DEPOSITO', label:'Depósito / Almacenamiento', family:'LOGISTICA', words:['deposito','almacen','warehouse','almacenamiento','centro de distribucion'] },
  { key:'COMEX', label:'Comercio exterior / Forwarding', family:'LOGISTICA', words:['comercio exterior','comex','forwarder','forwarding','despachante','aduana','carga internacional'] },
  { key:'PORTUARIO', label:'Portuario / Terminal', family:'LOGISTICA', words:['terminal portuaria','puerto','portuario','estiba'] },
  { key:'MANTENIMIENTO', label:'Mantenimiento industrial', family:'SERVICIO', words:['mantenimiento industrial','mantenimiento de planta','servicios de mantenimiento','facility maintenance'] },
  { key:'INGENIERIA_PROYECTOS', label:'Ingeniería / Proyectos', family:'SERVICIO', words:['ingenieria','ingeniería','proyectos industriales','project management','oficina tecnica','consultoria tecnica'] },
  { key:'CONSTRUCCION_MONTAJE', label:'Construcción / Montaje', family:'SERVICIO', words:['construccion','montaje','contratista','obra civil','piping','andamios'] },
  { key:'TECNOLOGIA', label:'Tecnología / Software', family:'SERVICIO', words:['software','tecnologia','sistemas','it ','desarrollo de software','informatica'] },
  { key:'RRHH_CAPACITACION', label:'RR.HH. / Capacitación', family:'SERVICIO', words:['recursos humanos','rrhh','seleccion de personal','capacitacion','formacion laboral'] },
  { key:'SEGURIDAD_AMBIENTE', label:'Seguridad / Higiene / Ambiente', family:'SERVICIO', words:['seguridad e higiene','higiene y seguridad','hse','medio ambiente','ambiental','sustentabilidad'] },
  { key:'CONSULTORIA', label:'Consultoría / Asesoramiento', family:'SERVICIO', words:['consultoria','consultora','asesoria','asesoramiento'] },
  { key:'FACILITIES', label:'Facilities / Limpieza / Servicios generales', family:'SERVICIO', words:['limpieza','facilities','servicios generales','facility'] },
];

function inferAdminCompanyPrimaryActivity(company = {}){
  const jobs = Array.isArray(company.jobs) ? company.jobs : [];
  const core = [company.companySummary, company.companyName, company.website].filter(Boolean).join(' ');
  const jobText = jobs.map((job) => [job.title, job.description, job.requirements, job.location].filter(Boolean).join(' ')).join(' ');
  const ranked = ADMIN_COMPANY_ACTIVITY_RULES.map((rule) => ({
    ...rule,
    score:(countAdminKeywords(core, rule.words) * 5) + countAdminKeywords(jobText, rule.words),
  })).sort((a,b) => b.score - a.score);
  if(ranked[0]?.score > 0){
    return { key:ranked[0].key, label:ranked[0].label, family:ranked[0].family, confidence:ranked[0].score >= 8 ? 'ALTA' : 'MEDIA' };
  }
  const summary = String(company.companySummary || '').trim().split(/[\n.!?]/)[0].trim();
  const compact = summary && summary.length <= 70 ? summary : '';
  if(compact){
    return { key:adminDynamicKey('ACT', compact), label:adminTitleCase(compact), family:null, confidence:'BAJA' };
  }
  return { key:'ACTIVIDAD_NO_ESPECIFICADA', label:'Actividad principal no especificada', family:null, confidence:'BAJA' };
}

function inferAdminCompanyCategory(company = {}){
  const manual = String(company.adminCategory || '').trim().toUpperCase();
  const primaryActivity = inferAdminCompanyPrimaryActivity(company);
  if(['FABRICACION','LOGISTICA','SERVICIO'].includes(manual)){
    return { key:manual, label:ADMIN_COMPANY_CATEGORY_LABELS[manual], source:'MANUAL', confidence:'ALTA', activityKey:primaryActivity.key, activityLabel:primaryActivity.label };
  }
  if(primaryActivity.family){
    return { key:primaryActivity.family, label:ADMIN_COMPANY_CATEGORY_LABELS[primaryActivity.family], source:'AUTO', confidence:primaryActivity.confidence, activityKey:primaryActivity.key, activityLabel:primaryActivity.label };
  }
  const jobs = Array.isArray(company.jobs) ? company.jobs : [];
  const core = [company.companyName, company.companySummary, company.website].filter(Boolean).join(' ');
  const jobText = jobs.map((job) => [job.title, job.description, job.requirements].filter(Boolean).join(' ')).join(' ');
  const scores = {
    FABRICACION: (countAdminKeywords(core, ['fabricacion','fabrica','manufactura','produccion industrial','planta industrial']) * 3) + countAdminKeywords(jobText, ['operario','produccion','planta']),
    LOGISTICA: (countAdminKeywords(core, ['logistica','transporte','deposito','distribucion','supply chain']) * 3) + countAdminKeywords(jobText, ['chofer','deposito','logistica']),
    SERVICIO: (countAdminKeywords(core, ['servicios','servicio','consultoria','mantenimiento','ingenieria','tecnologia','contratista']) * 3) + countAdminKeywords(jobText, ['tecnico','servicio','mantenimiento']),
  };
  const ranked = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  const bestKey = ranked[0]?.[0] || 'SERVICIO';
  const bestScore = ranked[0]?.[1] || 0;
  return {
    key:bestKey,
    label:ADMIN_COMPANY_CATEGORY_LABELS[bestKey],
    source:'AUTO',
    confidence:bestScore > 0 ? 'MEDIA' : 'BAJA',
    activityKey:primaryActivity.key,
    activityLabel:primaryActivity.label,
  };
}

function candidateCurrentProfessionalText(candidate = {}){
  const bolsa = candidate.candidateBolsa || {};
  const profile = candidate.candidateProfile || {};
  return adminNormText([
    bolsa.ultimoTrabajo,
    profile.headline,
    bolsa.especialidadOtro,
    bolsa.especialidad,
    bolsa.areaTrabajo,
  ].filter(Boolean).join(' '));
}

function candidateRecentProfessionalText(candidate = {}){
  const bolsa = candidate.candidateBolsa || {};
  const profile = candidate.candidateProfile || {};
  const resume = candidate.resume || {};
  return adminNormText([
    bolsa.ultimoTrabajo,
    String(resume.experience || '').slice(0, 1400),
    String(resume.summary || '').slice(0, 900),
    String(bolsa.voiceNarrativeProfessionalTitle || '').slice(0, 240),
    String(bolsa.voiceNarrativeSummary || bolsa.voiceNarrativeRaw || '').slice(0, 1200),
    bolsa.especialidadOtro,
    bolsa.especialidad,
    bolsa.areaTrabajo,
    profile.headline,
  ].filter(Boolean).join(' '));
}

function candidateAllProfessionalText(candidate = {}){
  const bolsa = candidate.candidateBolsa || {};
  const profile = candidate.candidateProfile || {};
  const resume = candidate.resume || {};
  return adminNormText([
    bolsa.areaTrabajo, bolsa.nivel, bolsa.especialidad, bolsa.especialidadOtro, bolsa.ultimoTrabajo, bolsa.observaciones, bolsa.voiceNarrativeProfessionalTitle, bolsa.voiceNarrativeSummary, bolsa.voiceNarrativeRaw,
    profile.headline, profile.sector, profile.subSector,
    resume.summary, resume.experience, resume.education, resume.certifications, resume.observations,
  ].filter(Boolean).join(' '));
}

function candidateRecentRoleLabel(candidate = {}){
  const bolsa = candidate.candidateBolsa || {};
  const profile = candidate.candidateProfile || {};
  const resume = candidate.resume || {};
  const direct = String(bolsa.ultimoTrabajo || bolsa.voiceNarrativeProfessionalTitle || profile.headline || '').trim().replace(/\s+/g, ' ');
  if(direct) return direct.slice(0, 140);
  const firstExperience = String(resume.experience || '').trim().split(/[\n.!?]/).map((x) => x.trim()).find(Boolean) || '';
  if(firstExperience) return firstExperience.slice(0, 140);
  const specialty = String(bolsa.especialidadOtro || (bolsa.especialidad === 'Otros' ? '' : bolsa.especialidad) || bolsa.areaTrabajo || '').trim().replace(/\s+/g, ' ');
  return specialty.slice(0, 140);
}

function inferAdminCandidateExpertise(candidate = {}){
  const bolsa = candidate.candidateBolsa || {};
  const profile = candidate.candidateProfile || {};
  const resume = candidate.resume || {};
  const current = candidateCurrentProfessionalText(candidate);
  const cvRecent = adminNormText([
    String(resume.experience || '').slice(0, 2600),
    String(resume.summary || '').slice(0, 1400),
  ].filter(Boolean).join(' '));
  const cvAll = adminNormText([resume.summary,resume.experience,resume.education,resume.certifications,resume.observations].filter(Boolean).join(' '));
  const voice = adminNormText([bolsa.voiceNarrativeProfessionalTitle,bolsa.voiceNarrativeSummary,bolsa.voiceNarrativeRaw].filter(Boolean).join(' '));
  const allText = candidateAllProfessionalText(candidate);
  const rules = [
    ['LOGISTICA', ['logistica','transporte','comercio exterior','comex','deposito','chofer','clark','autoelevador','despachante','ruteador','forwarder','supply chain']],
    ['INSTRUMENTACION', ['instrumentacion','instrumentista','automatizacion','automatista','plc','scada','dcs','calibracion']],
    ['ELECTRICA', ['electrica','electricista','tablerista','media tension','alta tension','bobinador','protecciones rele','subestacion','unifilar','trifilar','canalizacion electrica']],
    ['MECANICA', ['mecanica','mecanico','bombas','valvulas','compresores','turbomaquinas','hidraulica','neumatica','tornero','fresador','mecanizado']],
    ['SOLDADURA_MONTAJE', ['soldadura','soldador','caneria','canero','montaje','montajista','caldereria','calderero','piping']],
    ['MANTENIMIENTO', ['mantenimiento','planner mantenimiento','lubricacion','inspector de mantenimiento','confiabilidad','preventivo','correctivo','predictivo']],
    ['PRODUCCION', ['produccion','operador de planta','operador de proceso','sala de control','utilidades','manufactura']],
    ['CALIDAD_HSE', ['calidad','qa qc','inspector','ensayo no destructivo','seguridad higiene','hse','brigadista','iso 9001']],
    ['PLANIFICACION', ['planificacion','planificador','programacion','control de costos','primavera p6','ms project']],
    ['PROYECTOS', ['project manager','gerente de proyecto','jefe de proyecto','coordinador de proyecto','proyectos industriales','direccion de proyecto']],
    ['INGENIERIA', ['ingenieria','ingeniero','proyectista','oficina tecnica','cad','bim','calculista','calculo','dibujante tecnico','ingenieria de detalle']],
    ['CONSTRUCCION', ['construccion','obra civil','albanil','hormigon','encofrador','fierrero','andamiero','gruista','excavadora']],
    ['AMBIENTE', ['sustentabilidad','medio ambiente','gestion ambiental','huella de carbono','iso 14001','esg','residuos']],
    ['IT', ['software','helpdesk','sistemas','redes','ciberseguridad','frontend','backend','full stack','devops','data bi','testing','programador']],
    ['RRHH', ['rr hh','rrhh','recursos humanos','seleccion de personal','talento','liquidacion de sueldos']],
    ['FINANZAS', ['finanzas','contabilidad','tesoreria','facturacion','impuestos','contador','contable']],
    ['COMPRAS', ['compras','procurement','buyer','sourcing','compras tecnicas']],
    ['COMERCIAL', ['comercial','ventas','vendedor','ejecutivo de cuentas','account manager','marketing']],
    ['ADMINISTRACION', ['administrativo','administracion','secretaria','recepcion','back office']],
    ['LABORATORIO', ['laboratorio','laboratorista','analisis quimico','microbiologia','ensayos']],
    ['ENERGIA', ['energia','utilities','calderas','generacion','subestacion']],
  ];
  const ranked = rules.map(([key, words], order) => {
    const currentHits = countAdminKeywords(current, words);
    const cvRecentHits = countAdminKeywords(cvRecent, words);
    const cvAllHits = countAdminKeywords(cvAll, words);
    const voiceHits = countAdminKeywords(voice, words);
    const allHits = countAdminKeywords(allText, words);
    // v7.10.3: el CV completo deja de ser un simple fallback. Cuando existe,
    // participa fuertemente de la detección de expertise junto con el rol reciente.
    return { key, words, order, currentHits, cvRecentHits, cvAllHits, voiceHits, allHits,
      score:(currentHits * 14) + (cvRecentHits * 5) + (voiceHits * 4) + cvAllHits };
  }).sort((a,b) => b.score - a.score || b.currentHits - a.currentHits || b.cvRecentHits - a.cvRecentHits || b.cvAllHits - a.cvAllHits || a.order - b.order);
  const best = ranked[0];
  if(best?.score > 0){
    const source = best.currentHits > 0 ? 'RECENT' : (best.cvRecentHits > 0 ? 'CV_RECIENTE' : (best.cvAllHits > 0 ? 'CV_COMPLETO' : (best.voiceHits > 0 ? 'PRESENTACION' : 'GENERAL')));
    return { key:best.key, label:ADMIN_EXPERTISE_LABELS[best.key], source };
  }
  const raw = [bolsa.especialidadOtro, bolsa.especialidad, bolsa.areaTrabajo, profile.headline]
    .map((value) => String(value || '').trim())
    .find((value) => value && !/^(otros?|pendiente|no informado|sin dato)$/i.test(value));
  if(raw){
    const label = adminTitleCase(raw.slice(0, 64));
    return { key:adminDynamicKey('EXP', label), label, source:'DINAMICA' };
  }
  return { key:'GENERAL', label:ADMIN_EXPERTISE_LABELS.GENERAL, source:'FALLBACK' };
}

// v7.10.3: clasificación explicable calibrada contra el padrón real.
// Las presentaciones generadas, listas de habilidades y aspiraciones no son evidencia de experiencia.
const CANDIDATE_EVIDENCE_RULES = [
  ['INSTRUMENTACION','Instrumentación / Automatización','Técnico de instrumentación y automatización','TECNICO',/\b(instrumentista|automatista|tecnico (?:en |de )?instrumentacion|tecnico (?:en |de )?automatizacion|operari[oa] (?:en |de )?automatizacion|especialista (?:e )?i c)\b/,/\b(calibr(?:acion|aciones|ar|ado|ada|ados|adas)|lazos? de control|plc|scada|dcs|transmisores?|sensores? industriales?|instrumentacion industrial)\b/],
  ['ELECTRICA','Eléctrica','Electricista de instalaciones y mantenimiento','TECNICO',/\b(electricista|tablerista|bobinador|oficial electricista|oficial de conexiones(?: electricas?)?|operari[oa] electric[oa]|tecnico electric\w*)\b/,/\b(tableros? electric\w*|cableado|instalaciones? electricas?|conexiones? electricas?|medidores? (?:monofasicos?|trifasicos?)|monofasico|trifasico|media tension|alta tension|motores? electricos?|protecciones? electricas?|puesta a tierra)\b/],
  ['MECANICA','Mecánica','Mecánico de equipos y mantenimiento','TECNICO',/\b(mecanico|tornero|fresador|mecanizador|oficial mecanico|tecnico mecanico)\b/,/\b(bombas?|compresores?|hidraulica|neumatica|torno|fresa|mecanizado|rodamientos?|alineacion de equipos)\b/],
  ['SOLDADURA_MONTAJE','Soldadura / Montaje','Operario de soldadura y montaje','OPERATIVO',/\b(soldador|calderero|montajista|canista|canero|oficial soldador)\b/,/\b(soldadura|mig|tig|electrodo|caldereria|piping|montaje industrial)\b/],
  ['LOGISTICA','Logística / Depósito','Operario de logística y depósito','OPERATIVO',/\b(chofer|conductor|repartidor|operari[oa] de deposito|operari[oa] logistico|representante de envios|inbound representative|despachante de aduana\w*|ayudante de carga y descarga|preparador de pedidos|picker|clarkista|autoelevadorista|supervisor(?:a)? de logistica|jef[ea] de logistica|team leader de logistica|lider de logistica)\b/,/\b(picking|packing|wms|lectoras? de codigos? de barras|autoelevador|clark|inventario|carga y descarga|ruteo|almacenamiento|deposito|despacho|recepcion de mercaderia|preparacion de pedidos|distribucion|paqueteria|recepcion de vehiculos|coordinacion de vehiculos|logistica)\b/],
  ['COMERCIAL','Comercial / Atención al cliente','Atención al cliente y comercio','OPERATIVO',/\b(cajer[oa]|repositor(?:a)?|vendedor(?:a)?|preventista|promotor(?:a)?|asesor(?:a)? comercial|emplead[oa] de comercio|atencion al cliente|call center|telemarketer|despachante de supermercado)\b/,/\b(caja|cobros?|reposicion|atencion(?: y asesoramiento)? (?:al cliente|a clientes)|ventas?|asesoramiento (?:al publico|al cliente|a clientes)|servicio al cliente|pedidos de clientes)\b/],
  ['ADMINISTRACION','Administración','Administración y gestión documental','ADMINISTRATIVO',/\b(administrativ[oa]|secretari[oa]|recepcionista|asistente administrativ[oa]|responsable de administracion|gestor(?:a)?|gestoria|mandatari[oa](?: nacional| automotor)?|data entry|practicas? administrativas?)\b/,/\b(facturacion|archivo|expedientes?|carga de datos|gestion documental|documentacion administrativa|registros? administrativos?|remitos?|conciliaciones?|agenda|turnos|tramites|gestoria)\b/],
  ['FINANZAS','Finanzas / Contabilidad','Contabilidad, tesorería y finanzas','ADMINISTRATIVO',/\b(contador(?:a)?|analista contable|tesorer[oa]|analista financier[oa]|cuentas? a pagar|cuentas? por pagar|analista de cobranzas?|analista de creditos?|pasantia (?:en |del )?(?:el )?area de tesoreria)\b/,/\b(contabilidad|balances?|impuestos?|tesoreria|liquidacion de sueldos|pagos?|operaciones bancarias|posicion financiera|registracion contable|cobranzas?|riesgo crediticio|creditos?)\b/],
  ['RRHH','Recursos Humanos','Recursos humanos y selección','ADMINISTRATIVO',/\b(analista de recursos humanos|reclutador(?:a)?|selector(?:a)? de personal|asistente de recursos humanos|administrativ[oa] de rrhh)\b/,/\b(seleccion de personal|legajos|recursos humanos|rrhh|liquidacion de haberes|altas y bajas de personal)\b/],
  ['COMPRAS','Compras / Abastecimiento','Compras y abastecimiento','ADMINISTRATIVO',/\b(comprador(?:a)?|analista de compras|buyer|procurement)\b/,/\b(ordenes? de compra|compras? a proveedores|abastecimiento de materiales|negociacion con proveedores|sourcing|gestion de compras)\b/],
  ['IT','IT / Software','Desarrollo o soporte de sistemas','TECNICO',/\b(programador(?:a)?|desarrollador(?:a)?|devops|tecnico informatico|soporte tecnico informatico|analista de sistemas)\b/,/\b(programacion|python|javascript|sql|administracion de bases? de datos|redes informaticas|soporte informatico|desarrollo web|mantenimiento de computadoras?|reparacion de (?:pc|computadoras?)|soporte a usuarios|hardware|helpdesk)\b/],
  ['CALIDAD_HSE','Calidad / Seguridad e higiene','Calidad, inspección y seguridad e higiene','TECNICO',/\b(inspector(?:a)? de calidad|pasante (?:en |de )?calidad|tecnico en seguridad|tecnico en higiene|analista de calidad|controlador(?:a)? de calidad|brigadista)\b/,/\b(iso 9001|gmp|bpm|capa|desvios?|causa raiz|auditorias?|sistema de gestion de calidad|ensayos no destructivos|seguridad e higiene|higiene y seguridad|control de calidad|inspeccion de calidad|aseguramiento de calidad)\b/],
  ['SEGURIDAD','Seguridad / Vigilancia','Seguridad y vigilancia','OPERATIVO',/\b(vigilador(?:a)?|guardia de seguridad|seguridad privada|custodio|vigilancia)\b/,/\b(control de acceso|rondas?|vigilancia|control de ingreso|seguridad patrimonial)\b/],
  ['CONSTRUCCION','Construcción / Obra','Construcción y obra','OPERATIVO',/\b(albanil|andamiero|encofrador|fierrero|gruista|oficial de obra|ayudante de obra|inspector(?:a)? de obras?)\b/,/\b(hormigon|mamposteria|encofrado|obra civil|construccion|albanileria)\b/],
  ['PRODUCCION','Producción / Operaciones','Operación de producción y procesos','OPERATIVO',/\b(operari[oa](?: especializado)? de produccion|operari[oa] de ensamble|operador(?:a)? de planta|operador(?:a)? de proceso|operari[oa] industrial|operari[oa] de linea|supervisor(?:a)? de (?:produccion|linea(?: de (?:ensamble|produccion))?|ensamble|turno)|jef[ea] de produccion|coordinador(?:a)? de produccion)\b/,/\b(linea de produccion|linea de ensamble|ensamble|manufactura|envasado|packaging|sala de control|proceso productivo|produccion industrial|operacion de planta|embalaje)\b/],
  ['MANTENIMIENTO','Mantenimiento','Mantenimiento de equipos e instalaciones','TECNICO',/\b(tecnico de mantenimiento|operari[oa] de mantenimiento|mantenedor|mecanico de mantenimiento|electricista de mantenimiento|oficial de mantenimiento|supervisor(?:a)? de mantenimiento|jef[ea] de mantenimiento|responsable de mantenimiento)\b/,/\b(mantenimiento preventivo|mantenimiento correctivo|mantenimiento predictivo|reparacion de equipos|lubricacion|mantenimiento industrial|mantenimiento de planta|mantenimiento de equipos|mantenimiento de instalaciones)\b/],
  ['INGENIERIA','Ingeniería / Oficina técnica','Ingeniería y oficina técnica','PROFESIONAL',/\b(ingeniero|ingeniera|proyectista|calculista|dibujante tecnico)\b/,/\b(calculo estructural|planos|ingenieria de detalle|autocad|solidworks|oficina tecnica|documentacion tecnica)\b/],
  ['PROYECTOS','Proyectos / Project Management','Gestión de proyectos','PROFESIONAL',/\b(project manager|gerente de proyecto|jefe de proyecto|coordinador(?:a)? de proyecto|responsable de proyectos?)\b/,/\b(gestion de proyectos|proyectos industriales|project management|seguimiento de proyectos|planificacion de proyectos)\b/],
  ['PLANIFICACION','Planificación / Costos','Planificación y control','TECNICO',/\b(planificador(?:a)?|analista de costos|planner)\b/,/\b(primavera p6|ms project|cronogramas|control de costos|planificacion de mantenimiento|programacion de tareas)\b/],
  ['LABORATORIO','Laboratorio / Ensayos','Laboratorio y ensayos','TECNICO',/\b(laboratorista|tecnico de laboratorio|analista de laboratorio)\b/,/\b(analisis quimicos|ensayos de laboratorio|muestreo|microbiologia|control de muestras)\b/],
  ['LIMPIEZA','Limpieza / Maestranza','Limpieza y maestranza','OPERATIVO',/\b(personal de limpieza|operari[oa] de limpieza|maestranza|limpiador(?:a)?|mucam[oa])\b/,/\b(limpieza|higiene de espacios|orden de los espacios|mantenimiento de espacios|sanitizacion)\b/],
  ['GASTRONOMIA','Gastronomía / Catering','Gastronomía y atención de salón','OPERATIVO',/\b(moz[oa]|bachero|bachera|ayudante de cocina|peon de cocina|operari[oa] de cocina|cociner[oa]|catering|camarer[oa])\b/,/\b(toma de pedidos|servicio en salon|cocina|preparacion de alimentos|produccion y preparacion de alimentos|catering|lavado de vajilla|atencion en salon)\b/],
  ['EDUCACION','Educación / Capacitación','Docencia y capacitación','PROFESIONAL',/\b(profesor(?:a)?|docente|instructor(?:a)?|capacitador(?:a)?)\b/,/\b(dictado de clases|ensenanza|capacitacion de alumnos|formacion de alumnos|docencia|clases de informatica)\b/],
  ['SALUD','Salud / Emergencias','Atención sanitaria y emergencias','TECNICO',/\b(tecnic[oa] en emergencias sanitarias|paramedic[oa]|enfermer[oa]|tecnic[oa] en enfermeria|socorrista)\b/,/\b(atencion prehospitalaria|emergencias sanitarias|triage|utim|same|sistema 107|primeros auxilios|atencion hospitalaria)\b/],
  ['CUIDADOS','Cuidados / Asistencia personal','Cuidados y asistencia personal','OPERATIVO',/\b(niner[oa]|cuidador(?:a)?|acompanante de personas|asistente domiciliari[oa])\b/,/\b(cuidado infantil|cuidado de personas|rutinas diarias|asistencia personal)\b/],
  ['SERVICIOS_PERSONALES','Servicios personales','Servicios personales','OPERATIVO',/\b(barbero|peluquer[oa]|manicur[oa]|esteticista)\b/,/\b(corte de cabello|barberia|manicuria|unas|tratamientos capilares)\b/],
];

const CANDIDATE_ACTION_SIGNAL=/\b(trabaj\w*|me desempen\w*|desempen\w*|realiz\w*|oper\w*|repar\w*|instal\w*|calibr\w*|supervis\w*|coordin\w*|gestion\w*|administr\w*|atiendo|atendi|atencion|manten\w*|control\w*|carg\w*|descarg\w*|analiz\w*|condu\w*|encarg\w*|responsable|prepar\w*|vend\w*|cobr\w*|factur\w*|limpi\w*|cocin\w*|asisti\w*|inspeccion\w*)\b/;
const CANDIDATE_GENERIC_ROLE_SIGNAL=/\b(emplead[oa]|operari[oa]|operador(?:a)?|tecnic[oa]|oficial|ayudante|auxiliar|asistente|responsable de [a-z]+|encargad[oa]|supervisor(?:a)?|jef[ea]|coordinador(?:a)?|gerente|director(?:a)?|vigilador(?:a)?|moz[oa]|bachero|bachera|niner[oa]|cajer[oa]|repositor(?:a)?|vendedor(?:a)?|chofer|conductor|repartidor|inspector(?:a)?|analista|project manager|pasante|practicas? profesionales?)\b/;
const CANDIDATE_WORK_TASK_SIGNAL=/\b(atencion al cliente|caja|cobros?|ventas?|limpieza|carga y descarga|deposito|inventario|facturacion|tesoreria|cuentas? a pagar|control de calidad|inspeccion de calidad|mantenimiento (?:preventivo|correctivo|industrial|de equipos)|produccion|cocina|catering|seguridad privada|control de acceso|atencion prehospitalaria)\b/;
const CANDIDATE_DATE_SIGNAL=/\b(?:(?:19|20)\d{2}\s*(?:[-–—]|a|hasta)\s*(?:(?:19|20)\d{2}|actualidad|presente|actual)|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(?:19|20)\d{2})\b/;

function candidateWorkEvidenceStrength(line=''){
  const t=adminNormText(line);
  if(!t || /\b(sin experiencia laboral|sin experiencia previa|sin experiencia formal|no tengo experiencia laboral)\b/.test(t)) return 0;
  let score=0;
  if(CANDIDATE_GENERIC_ROLE_SIGNAL.test(t)) score+=3;
  if(CANDIDATE_ACTION_SIGNAL.test(t)) score+=2;
  if(CANDIDATE_WORK_TASK_SIGNAL.test(t)) score+=2;
  if(CANDIDATE_DATE_SIGNAL.test(String(line || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())) score+=3;
  if(/\b(experiencia laboral|experiencia profesional|empleador|empresa|trabajo|puesto)\b/.test(t)) score+=1;
  if(/\b(habilidades|competencias|aptitudes|objetivo|sobre mi|perfil profesional|educacion|formacion|curso|cursando|estudiante)\b/.test(t) && score<3) score=Math.max(0,score-2);
  if(/\b(cv generado con talento pyme|trayectoria no determinada|pendiente)\b/.test(t) && !CANDIDATE_GENERIC_ROLE_SIGNAL.test(t) && !CANDIDATE_WORK_TASK_SIGNAL.test(t) && !CANDIDATE_DATE_SIGNAL.test(t)) score=0;
  return score;
}

function candidateEvidenceLines(value){
  return [...new Set(String(value || '').split(/[\n.;!?•]+|\s+\|\s+/).map(x=>x.trim()).filter(Boolean))].filter(line => {
    const t=adminNormText(line);
    if(!t || /^(experiencia laboral|experiencia profesional|experiencia|historial laboral|habilidades|competencias|aptitudes|educacion|formacion|contacto|datos personales)$/.test(t)) return false;
    const workStrength=candidateWorkEvidenceStrength(line);
    const aspirational=/\b(busco|buscando|me gustaria|quisiera|deseo|objetivo|aspir\w*|adquirir experiencia|ganas de aprender|dispuesto a aprender|formar parte de una empresa|incorporarse al mundo laboral|incorporarme al mundo laboral|busco mejorar mi experiencia|busco adquirir experiencia)\b/.test(t);
    const educationMarker=/\b(curso|cursando|estudiante|estudio|escuela|colegio|secundario|formacion|capacitacion|universidad|terciario)\b/.test(t);
    const clearEmployment=/\b(empleador|empresa|trabaje|trabajo en|operari[oa]|emplead[oa]|vigilador(?:a)?|moz[oa]|bachero|bachera|cajer[oa]|repositor(?:a)?|vendedor(?:a)?|chofer|conductor|supervisor(?:a)?|jef[ea]|gerente|project manager|responsable de area|asistente administrativ[oa]|analista|inspector(?:a)?)\b/.test(t) || CANDIDATE_WORK_TASK_SIGNAL.test(t);
    const educationOnly=educationMarker && !clearEmployment;
    const skillsOnly=/\b(habilidades|competencias|aptitudes|fortalezas)\b/.test(t) && !clearEmployment;
    if(educationOnly || skillsOnly || aspirational) return false;
    return !/\b(no realic\w* trabajos?|no trabaje|no cuento con experiencia)\b/.test(t);
  });
}

function candidateWorkPeriodPrefix(line=''){
  const t=String(line || '').replace(/[‐‑‒–—]/g,'-');
  const present='(?:actualidad|presente|actual|hoy|current|present)';
  const monthName='(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t(?:iembre)?)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\\.?';
  const patterns=[
    // Fecha completa: 10/01/2025 - 05/06/2025
    new RegExp(`\\b\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-](?:19|20)\\d{2}\\s*(?:-|a|hasta)\\s*(?:\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-](?:19|20)\\d{2}|${present})\\b`,'i'),
    // Mes/año: 01/2024 - 06/2026 / 04-24 - actualidad
    new RegExp(`\\b(?:0?[1-9]|1[0-2])[\\/.\\-]\\d{2,4}\\s*(?:-|a|hasta)\\s*(?:(?:0?[1-9]|1[0-2])[\\/.\\-]\\d{2,4}|${present})\\b`,'i'),
    // Mes escrito: Mar 2025 - Jul 2026 / noviembre 2022 - actualidad
    new RegExp(`\\b${monthName}\\s+(?:de\\s+)?(?:19|20)\\d{2}\\s*(?:-|a|hasta)\\s*(?:${monthName}\\s+(?:de\\s+)?(?:19|20)\\d{2}|${present})\\b`,'i'),
    // Sólo años: 2022 - 2025
    new RegExp(`\\b(?:19|20)\\d{2}\\s*(?:-|a|hasta)\\s*(?:(?:19|20)\\d{2}|${present})\\b`,'i'),
  ];
  for(const rx of patterns){
    const m=t.match(rx);
    if(m?.[0]) return m[0];
  }
  return '';
}

function candidateEvidenceHitAccepted(rule,line,{roleHit=false,taskHit=false,src={}}={}){
  const key=rule?.[0] || '';
  const t=adminNormText(line);
  if(!t) return false;
  // v8.0.1: palabras instrumentales no crean profesiones por sí solas.
  if(key==='IT' && taskHit){
    if(/\b(base de datos de (?:mantenimiento|equipos|activos|akz|aca)|software (?:de|para) (?:gestion|administracion|diseno)|sistema documental)\b/.test(t) && !/\b(programacion|desarrollo|soporte informatico|redes informaticas|sql|helpdesk|reparacion de (?:pc|computadoras?))\b/.test(t)) return false;
  }
  if(key==='MANTENIMIENTO' && taskHit && /\b(mantenimiento (?:del orden|de registros?|de documentacion|de limpieza|de espacios))\b/.test(t)) return false;
  if(key==='COMPRAS' && taskHit && /\b(cotiz(?:ar|acion|aciones)|proveedores?)\b/.test(t) && !/\b(compras?|ordenes? de compra|abastecimiento de materiales|negociacion|sourcing)\b/.test(t)) return false;
  if(key==='SEGURIDAD' && /\b(porteria|portero|portera)\b/.test(t) && !/\b(control de acceso|vigilancia|seguridad patrimonial|rondas?|control de ingreso)\b/.test(t)) return false;
  if(key==='INSTRUMENTACION' && taskHit && /\b(calibre|calibres)\b/.test(t) && !/\b(calibracion|calibrar|lazo de control|plc|scada|dcs|transmisor|sensor industrial)\b/.test(t)) return false;
  return roleHit || taskHit;
}

function candidateVerifiedProfessionalEvidence(candidate={}){
  const b=candidate.candidateBolsa || {}, r=candidate.resume || {};
  const recent=candidateEvidenceLines(b.ultimoTrabajo);
  let period='',carry=0;
  const rawParts=String(r.experience || '').split(/[\n.;!?•]+|\s+\|\s+/).map(x=>String(x||'').trim()).filter(Boolean);
  const decorated=[...rawParts];

  // Algunos CV ubican el período antes de las tareas y otros al final del bloque.
  // Primera pasada: hereda hacia adelante un período detectado.
  for(let i=0;i<rawParts.length;i++){
    const line=rawParts[i];
    const found=candidateWorkPeriodPrefix(line);
    if(found){
      period=found;
      const idx=line.indexOf(found);
      const after=idx>=0 ? line.slice(idx+found.length) : '';
      // Si después del rango ya aparece un nuevo cargo, el rango queda asociado
      // a la línea actual y no se hereda a las tareas del puesto siguiente.
      carry=CANDIDATE_GENERIC_ROLE_SIGNAL.test(adminNormText(after)) ? 0 : 5;
      continue;
    }
    if(period && carry>0 && candidateWorkEvidenceStrength(line)>=2) decorated[i]=`${period} ${line}`;
    if(carry>0) carry-=1;
    if(/\b(educacion|formacion|habilidades|competencias|datos personales|contacto)\b/i.test(line)) {period='';carry=0;}
  }

  // Las fechas posteriores al bloque se resuelven más abajo con una asociación
  // de proximidad acotada. No se propagan hacia atrás en forma general para evitar
  // transferir antigüedad entre trabajos de especialidades distintas.

  const datedWork=decorated.join('\n');
  const work=candidateEvidenceLines(datedWork);
  // Relato original únicamente cuando describe una acción laboral, nunca el texto ampliado por IA.
  const voice=candidateEvidenceLines(b.voiceNarrativeRaw).filter(x=>CANDIDATE_ACTION_SIGNAL.test(adminNormText(x)) || candidateWorkEvidenceStrength(x)>=4);
  const lines=[...new Set([...recent,...work,...voice])];
  const sourceMap=new Map();
  for(const line of lines) sourceMap.set(line,{recent:recent.includes(line),work:work.includes(line),voice:voice.includes(line)});
  const recentText=adminNormText(recent.join(' '));
  const ranked=CANDIDATE_EVIDENCE_RULES.map(rule=>{
    const hits=[];
    let role=false,task=false,weight=0;
    for(const line of lines){
      const t=adminNormText(line), src=sourceMap.get(line)||{};
      const roleHit=rule[4].test(t), taskHit=rule[5].test(t);
      const taskAccepted=taskHit && (CANDIDATE_ACTION_SIGNAL.test(t) || src.recent || (src.work && candidateWorkEvidenceStrength(line)>=3) || src.voice);
      if(!candidateEvidenceHitAccepted(rule,line,{roleHit,taskHit:taskAccepted,src})) continue;
      hits.push(line); role ||= roleHit; task ||= taskHit;
      if(src.recent) weight += roleHit?10:5;
      else if(src.work) weight += roleHit?5:3;
      else if(src.voice) weight += roleHit?4:2;
      if(roleHit && taskHit) weight += 2;
    }
    if(rule[4].test(recentText)) weight+=4;
    if(rule[5].test(recentText)) weight+=2;
    return {rule,hits:[...new Set(hits)],role,task,weight};
  }).filter(x=>x.role || x.task).sort((a,b)=>b.weight-a.weight || b.hits.length-a.hits.length);
  const credibleWork=[...new Set([...recent,...work,...voice].filter(x=>{
    const t=adminNormText(x), strength=candidateWorkEvidenceStrength(x);
    const employerDated=CANDIDATE_DATE_SIGNAL.test(String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()) && /\b(empresa|empleador)\b/.test(t);
    const substantive=CANDIDATE_GENERIC_ROLE_SIGNAL.test(t) || CANDIDATE_WORK_TASK_SIGNAL.test(t) || CANDIDATE_ACTION_SIGNAL.test(t) || employerDated;
    return (strength>=4 && substantive) || (recent.includes(x) && CANDIDATE_GENERIC_ROLE_SIGNAL.test(t));
  }))];
  return {lines,recent,work,voice,credibleWork,ranked};
}

function candidateMonthNumber(name=''){
  const key=adminNormText(name);
  return {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}[key] || null;
}
function candidateEvidenceYears(lines, now=new Date()){
  // Duraciones de empleo verificables. Se descartan fechas de educación/otros bloques
  // cuando el extractor dejó varias secciones del CV en una misma línea.
  const prepared=(lines || []).map(value=>{
    let line=String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[‐‑‒–—]/g,'-');
    const workMarker=line.search(/\b(experiencia laboral|experiencia profesional|experiencia de trabajo|historial laboral)\b/);
    // Si la línea fue enriquecida con un período laboral al comienzo, conservarlo.
    // Una fecha escolar anterior al marcador de experiencia no debe sobrevivir.
    const prefixedPeriod=candidateWorkPeriodPrefix(line);
    const periodAtStart=!!prefixedPeriod && line.indexOf(prefixedPeriod)===0;
    if(workMarker>=0 && !periodAtStart) line=line.slice(workMarker);
    const stop=line.search(/\b(educacion|formacion academica|formacion profesional|habilidades|competencias|datos personales|contacto)\b/);
    if(stop>0) line=line.slice(0,stop);
    return line;
  }).filter(Boolean);
  const raw=prepared.join('\n');
  const explicit=[...raw.matchAll(/\b(\d{1,2})\s*a(?:n|ñ)os\s+(?:de\s+)?(?:experiencia|trabajando|en el puesto|como\s+\w+)/gi)].map(x=>Number(x[1])).filter(x=>x<=65);
  const intervals=[];
  const nowMonth=now.getFullYear()*12+now.getMonth();

  const normalizeYear=(value)=>{
    const token=String(value ?? '').trim().toLowerCase();
    if(/actualidad|presente|actual|hoy|current|present/.test(token)) return now.getFullYear();
    const n=Number(token);
    if(!Number.isFinite(n)) return null;
    if(n>=1900 && n<=now.getFullYear()+1) return n;
    if(n>=0 && n<=99){
      const pivot=(now.getFullYear()%100)+1;
      return n<=pivot?2000+n:1900+n;
    }
    return null;
  };
  const add=(sy,sm,ey,em)=>{
    const startYear=normalizeYear(sy), endYear=normalizeYear(ey);
    if(!startYear || !endYear) return;
    const start=startYear*12+(Number(sm)-1), end=endYear*12+(Number(em)-1);
    if(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=nowMonth&&end-start<=65*12) intervals.push([start,end]);
  };

  // Fecha completa: 10/01/2025 - 05/06/2025
  const fullDateMatches=[...raw.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})\s*(?:-|a|hasta)\s*(?:(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})|(actualidad|presente|actual|hoy|current|present))\b/gi)];
  for(const m of fullDateMatches){
    const sy=m[3], sm=Number(m[2]);
    if(m[7]) add(sy,sm,now.getFullYear(),now.getMonth()+1);
    else add(sy,sm,m[6],Number(m[5]));
  }

  // Mes/año numérico: 01/2024 - 06/2026, 10/23 - 01/24, 03-2024 - actualidad.
  const numericMonthMatches=[...raw.matchAll(/\b(0?[1-9]|1[0-2])[\/.\-](\d{2,4})\s*(?:-|a|hasta)\s*(?:(0?[1-9]|1[0-2])[\/.\-](\d{2,4})|(actualidad|presente|actual|hoy|current|present))\b/gi)];
  for(const m of numericMonthMatches){
    const sy=m[2], sm=Number(m[1]);
    if(m[5]) add(sy,sm,now.getFullYear(),now.getMonth()+1);
    else add(sy,sm,m[4],Number(m[3]));
  }

  const monthMap={ene:1,enero:1,feb:2,febrero:2,mar:3,marzo:3,abr:4,abril:4,may:5,mayo:5,jun:6,junio:6,jul:7,julio:7,ago:8,agosto:8,sep:9,sept:9,septiembre:9,set:9,setiembre:9,oct:10,octubre:10,nov:11,noviembre:11,dic:12,diciembre:12};
  const month='(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t(?:iembre)?)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\\.?';
  const re=new RegExp(`\\b${month}\\s+(?:de\\s+)?((?:19|20)\\d{2})\\s*(?:-|a|hasta)\\s*(?:${month}\\s+(?:de\\s+)?((?:19|20)\\d{2})|(actualidad|presente|actual|hoy|current|present))\\b`,'gi');
  const monthMatches=[...raw.matchAll(re)];
  for(const m of monthMatches){
    const sy=m[2], sm=monthMap[String(m[1]||'').replace(/\.$/,'')];
    if(!sm) continue;
    if(m[5]) add(sy,sm,now.getFullYear(),now.getMonth()+1);
    else {const em=monthMap[String(m[3]||'').replace(/\.$/,'')]; if(em) add(sy,sm,m[4],em);}
  }

  // Evita contar otra vez años ya contenidos en rangos más específicos.
  let yearOnlyRaw=raw;
  const specificMatches=[...fullDateMatches,...numericMonthMatches,...monthMatches].sort((a,b)=>(b.index??0)-(a.index??0));
  for(const m of specificMatches){
    const idx=m.index??-1;
    if(idx>=0) yearOnlyRaw=yearOnlyRaw.slice(0,idx)+' '.repeat(m[0].length)+yearOnlyRaw.slice(idx+m[0].length);
  }

  // Sólo años: 2016 - 2023
  for(const m of yearOnlyRaw.matchAll(/\b((?:19|20)\d{2})\s*(?:-|a|hasta)\s*((?:19|20)\d{2}|actualidad|presente|actual|hoy|current|present)\b/gi)){
    const sy=m[1];
    if(/^\d/.test(m[2])) add(sy,1,m[2],1); else add(sy,1,now.getFullYear(),now.getMonth()+1);
  }

  intervals.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const x of intervals){
    const prev=merged.at(-1);
    if(prev && x[0]<=prev[1]) prev[1]=Math.max(prev[1],x[1]);
    else merged.push([...x]);
  }
  const months=merged.length?merged.reduce((n,x)=>n+Math.max(0,x[1]-x[0]),0):null;
  const dated=months!==null;
  const datedYears=dated?Math.round((months/12)*10)/10:null;
  return {years:datedYears!==null?datedYears:(explicit.length?Math.max(...explicit):null),dated};
}
function candidateIsPreciseWorkPeriod(period=''){
  const p=String(period || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[‐‑‒–—]/g,'-');
  if(!p.trim()) return false;
  if(/\b(?:ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|set|setiembre|oct|octubre|nov|noviembre|dic|diciembre)\b/.test(p)) return true;
  if(/\b(?:0?[1-9]|1[0-2])[\/.\-]\d{2,4}\b/.test(p)) return true;
  if(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:19|20)\d{2}\b/.test(p)) return true;
  return false;
}

function candidateNearbyRelevantPeriodLines(best=null, workLines=[]){
  if(!best?.hits?.length || !workLines?.length) return [];
  const hitSet=new Set(best.hits);
  const found=[];
  for(let i=0;i<workLines.length;i++){
    if(!hitSet.has(workLines[i])) continue;
    for(let j=i+1;j<workLines.length && j<=i+12;j++){
      const line=workLines[j];
      const period=candidateWorkPeriodPrefix(line);
      const strength=candidateWorkEvidenceStrength(line);
      if(period && (candidateIsPreciseWorkPeriod(period) || j<=i+2) && (strength<=3 || j<=i+3)){
        found.push(period);
        break;
      }
      // Un nuevo puesto fuerte antes de encontrar la fecha corta la asociación.
      if(j>i+1 && strength>=4 && CANDIDATE_GENERIC_ROLE_SIGNAL.test(adminNormText(line))) break;
    }
  }
  return [...new Set(found)];
}


function candidateEvidenceLatestYear(lines=[], now=new Date()){
  const currentYear=now.getFullYear();
  let latest=null;
  for(const raw of lines || []){
    const text=adminNormText(raw);
    if(/\b(actualidad|presente|actual|hoy|current|present)\b/.test(text)) latest=currentYear;
    for(const m of String(raw || '').matchAll(/\b((?:19|20)\d{2})\b/g)){
      const year=Number(m[1]);
      if(year>=1950 && year<=currentYear+1) latest=latest===null?year:Math.max(latest,year);
    }
  }
  return latest;
}

function candidateExpertiseSpecificity(key=''){
  return ({INSTRUMENTACION:100,ELECTRICA:98,MECANICA:96,SOLDADURA_MONTAJE:94,INGENIERIA:92,PROYECTOS:90,PLANIFICACION:88,CALIDAD_HSE:86,IT:84,LABORATORIO:82,CONSTRUCCION:80,PRODUCCION:78,LOGISTICA:76,SEGURIDAD:74,GASTRONOMIA:72,RRHH:70,FINANZAS:68,COMPRAS:66,ADMINISTRACION:64,MANTENIMIENTO:60,COMERCIAL:58,LIMPIEZA:56,EDUCACION:54,SALUD:52,CUIDADOS:50,SERVICIOS_PERSONALES:48}[key] || 0);
}
function candidateRankedWithRecency(ev={}, now=new Date()){
  const recentSet=new Set(ev.recent || []);
  return (ev.ranked || []).map((item)=>{
    const recentHits=(item.hits || []).filter((line)=>recentSet.has(line));
    // v8.0.1: algunos CV separan el cargo de su período en la línea siguiente.
    // Asociamos sólo períodos cercanos sin transferir antigüedad a otros puestos.
    const nearbyPeriods=candidateNearbyRelevantPeriodLines(item,ev.work||[]);
    const directLatestYear=candidateEvidenceLatestYear(item.hits||[],now);
    const latestYear=candidateEvidenceLatestYear([...(item.hits||[]),...nearbyPeriods],now);
    const evidenceQuality=item.role && item.task ? 3 : (item.role ? 2 : (item.task ? 1 : 0));
    return {...item,recentHits,directLatestYear,latestYear,evidenceQuality};
  }).sort((a,b)=>{
    const ar=a.recentHits.length?1:0, br=b.recentHits.length?1:0;
    if(ar!==br) return br-ar;
    if(ar && br){
      if((a.evidenceQuality||0)!==(b.evidenceQuality||0)) return (b.evidenceQuality||0)-(a.evidenceQuality||0);
      const as=candidateExpertiseSpecificity(a.rule?.[0]), bs=candidateExpertiseSpecificity(b.rule?.[0]);
      if(as!==bs) return bs-as;
    }
    const ay=a.latestYear||0, by=b.latestYear||0;
    if(ay && by && Math.abs(ay-by)>=5) return by-ay;
    if((a.evidenceQuality||0)!==(b.evidenceQuality||0)) return (b.evidenceQuality||0)-(a.evidenceQuality||0);
    if(ay!==by) return by-ay;
    const as=candidateExpertiseSpecificity(a.rule?.[0]), bs=candidateExpertiseSpecificity(b.rule?.[0]);
    if(as!==bs) return bs-as;
    if((a.weight||0)!==(b.weight||0)) return (b.weight||0)-(a.weight||0);
    return (b.hits?.length||0)-(a.hits?.length||0);
  });
}

function candidateSecondaryProfiles(ranked=[], primary=null, now=new Date()){
  const currentYear=now.getFullYear();
  const out=[];
  const seen=new Set([primary?.rule?.[0]].filter(Boolean));
  for(const item of ranked){
    const key=item?.rule?.[0];
    if(!key || seen.has(key)) continue;
    const recent=Array.isArray(item.recentHits) && item.recentHits.length>0;
    const secondaryLatestYear=item.directLatestYear ?? item.latestYear ?? null;
    const withinFiveYears=secondaryLatestYear!=null && (currentYear-secondaryLatestYear)<=5;
    const withinTenYears=secondaryLatestYear!=null && (currentYear-secondaryLatestYear)<=10;
    const strong=!!item.role && !!item.task && (item.hits?.length||0)>=2 && (item.weight||0)>=8;
    if(!strong || (!recent && !withinTenYears)) continue;
    // v8.0.1: sólo una especialidad complementaria vigente y con evidencia fuerte
    // puede participar del buscador. Lo demás se conserva como antecedente visible.
    const searchable=recent && (item.weight||0)>=10;
    out.push({
      key,
      label:item.rule[1],
      profileTitle:item.rule[2],
      type:searchable?'COMPLEMENTARIO':'ANTECEDENTE',
      confidence:searchable?'MEDIA':'BAJA',
      searchable,
      latestYear:secondaryLatestYear || null,
      reason:searchable?'Actividad complementaria vigente con cargo y tareas verificables.':(withinFiveYears?'Antecedente reciente, visible pero no utilizado para búsquedas automáticas.':'Antecedente histórico, visible pero no utilizado para búsquedas automáticas.'),
      evidence:(item.hits||[]).slice(0,2),
    });
    seen.add(key);
    if(out.length>=2) break;
  }
  return out;
}


// v8.0.2: para perfiles de entrada sin estudios/orientación suficientes, usamos sólo
// saberes y tareas que la propia persona haya declarado. Esto permite distinguir
// aprendices de cocina, limpieza, cuidado, logística, construcción, etc. sin inventar
// experiencia profesional ni convertir palabras aisladas en un oficio.
function candidateDeclaredApprenticeOrientation(candidate={}){
  const b=candidate.candidateBolsa || {}, r=candidate.resume || {};
  const chunks=[
    ['ULTIMO_TRABAJO',b.ultimoTrabajo,5],
    ['RELATO_ORIGINAL',b.voiceNarrativeRaw,5],
    ['OBSERVACIONES',b.observaciones,3],
    ['EXPERIENCIA_CV',r.experience,5],
    ['RESUMEN_CV',r.summary,2],
    ['OTROS_DATOS_CV',r.observations,2],
  ].filter(([,value])=>String(value||'').trim());
  const boilerplate=/\b(perfil general|expertise no determinado|trayectoria no determinada|cv generado con talento pyme|estoy construyendo mi perfil profesional|puedo completar experiencia|perfil detectado|resumen profesional optimizado)\b/;
  const rules=[
    ['GASTRONOMIA','cocina / gastronomía',[/\b(cocin(?:a|ar|ero|era)|ayudante de cocina|peon de cocina|bachero|bachera|mozo|moza|pizzeria|panaderia|gastronomia|comida|elaboracion de alimentos)\b/,/\b(prepar(?:o|ar|acion)\w* (?:comida|alimentos|pizzas?|empanadas?)|lav(?:o|ar) platos|servicio de mesa)\b/]],
    ['LIMPIEZA','limpieza / maestranza',[/\b(limpieza|maestranza|mucam(?:a|o)|limpi(?:o|ar)|higiene de espacios|aseo)\b/,/\b(lav(?:o|ar) pisos|orden y limpieza|limpieza de casas?|limpieza de oficinas?)\b/]],
    ['CUIDADOS','cuidado de personas',[/\b(niñer(?:a|o)|cuidador(?:a)?|cuidado de niñ(?:os|as)|cuidado de adultos?|acompañante de adultos?|geriatrico)\b/,/\b(cuido (?:niños|niñas|chicos|chicas|personas|adultos))\b/]],
    ['ATENCION_CLIENTE','atención al cliente / ventas',[/\b(atencion al cliente|ventas?|vendedor(?:a)?|cajer(?:o|a)|comercio|repositor(?:a)?|mostrador|recepcionista)\b/,/\b(cobros?|caja|asesoramiento a clientes?|reposicion de mercaderia)\b/]],
    ['LOGISTICA','logística / depósito',[/\b(logistica|deposito|almacen|picking|packing|distribucion|despacho|recepcion de mercaderia|preparacion de pedidos|control de stock|repositor(?:a)?)\b/,/\b(carga y descarga|armado de pedidos|movimiento de mercaderia)\b/]],
    ['CONSTRUCCION','construcción / albañilería',[/\b(albañil|albañileria|ayudante de albañil|construccion|obra|obra civil|durlock|revoque|mamposteria)\b/,/\b(mezcla|hormigon|ladrillos?|reparaciones de obra)\b/]],
    ['SEGURIDAD','seguridad / vigilancia',[/\b(seguridad privada|vigilador(?:a)?|vigilancia|control de acceso|custodia|cctv)\b/]],
    ['PRODUCCION','producción / tareas operativas',[/\b(produccion|operari[oa]|linea de produccion|ensamble|envasado|embalaje|manufactura|planta)\b/]],
    ['ELECTRICA','eléctrico',[/\b(electricidad|electricista|instalaciones electricas|cableado|tableros electricos|enchufes?|luminarias?)\b/]],
    ['MECANICA','mecánico',[/\b(mecanica|mecanico|mantenimiento de autos?|automotores?|motores?|frenos?|embrague)\b/]],
    ['MANTENIMIENTO','mantenimiento general',[/\b(mantenimiento general|reparaciones generales|arreglos generales)\b/]],
    ['PINTURA','pintura',[/\b(pintor(?:a)?|pintura de obra|pintura de casas?|pintar paredes)\b/]],
    ['JARDINERIA','jardinería',[/\b(jardineria|jardinero|corte de pasto|parquizacion|poda)\b/]],
    ['TEXTIL','costura / textil',[/\b(costura|costurera|costurero|maquina de coser|confeccion textil)\b/]],
    ['CONDUCCION','conducción / reparto',[/\b(chofer|conductor(?:a)?|repartidor(?:a)?|delivery|reparto|mensajeria)\b/]],
    ['ESTETICA','peluquería / estética',[/\b(peluqueria|peluquero|peluquera|manicura|manicurista|estetica|barberia)\b/]],
    ['ADMINISTRACION','administrativo',[/\b(administracion|administrativo|administrativa|carga de datos|archivo|recepcion)\b/]],
  ];
  const scored=[];
  for(const [key,label,patterns] of rules){
    let score=0; const evidence=[]; const sources=[];
    for(const [source,value,weight] of chunks){
      const text=adminNormText(value);
      if(!text || boilerplate.test(text)) continue;
      const hits=patterns.filter((rx)=>rx.test(text)).length;
      if(hits){ score += weight + Math.max(0,hits-1); evidence.push(String(value).replace(/\s+/g,' ').trim().slice(0,220)); sources.push(source); }
    }
    if(score>0) scored.push({key,label,score,evidence:[...new Set(evidence)].slice(0,2),sources:[...new Set(sources)]});
  }
  scored.sort((a,b)=>b.score-a.score || a.label.localeCompare(b.label,'es'));
  const best=scored[0] || null;
  // Una sola mención débil en texto generado no alcanza. Relato, último trabajo o
  // experiencia CV sí constituyen una declaración suficientemente directa para orientar.
  if(!best || best.score<5) return null;
  return best;
}

// v8.0.1: cuando no existe experiencia laboral verificable, la formación deja de
// quedar escondida bajo "información profesional por completar". Se utiliza para
// construir una categoría de Aprendiz o Pasante que sea útil y buscable.
function candidateEducationOrientation(candidate={}){
  const b=candidate.candidateBolsa || {}, r=candidate.resume || {};
  const overflowEducation=[r.summary,r.experience].filter(Boolean).join(' ').split(/[\n.;!?•]+|\s+\|\s+/).filter((line)=>/\b(educacion|formacion academica|estudios?|secundari\w*|bachiller|escuela tecnica|tecnico electromecanico|tecnico electric\w*|tecnico mecanico|tecnico electronico|tecnico quimico|universidad|universitari\w*|ingenieria|licenciatura|terciari\w*|tecnicatura superior|tecnico superior|profesorado|isfd|isft|instituto superior)\b/i.test(adminNormText(line))).join(' ');
  const rawEducation=[r.education,overflowEducation,b.nivelEducativo].filter(Boolean).join(' ');
  const education=adminNormText(rawEducation);
  const declaredOrientation=adminNormText([b.especialidad,b.areaTrabajo].filter(Boolean).join(' '));
  const higher=/\b(universidad|universitari\w*|ingenieria|ingeniero|ingeniera|licenciatura|terciari\w*|tecnicatura superior|tecnico superior|profesorado|isfd|isft|instituto superior)\b/.test(education) || /\b(terciaria|universitaria)\b/.test(adminNormText(b.nivelEducativo||''));
  const secondary=/\b(secundari\w*|bachiller|escuela tecnica|tecnico electromecanico|tecnico electric\w*|tecnico mecanico|tecnico electronico|tecnico quimico|tecnico maestro mayor)\b/.test(education) || /\bsecundaria\b/.test(adminNormText(b.nivelEducativo||''));

  const rules=[
    ['ELECTROMECANICA','electromecánico',/\b(electromecanic\w*)\b/],
    ['ELECTRICA','eléctrico',/\b(electric\w*|electricidad|instalaciones electricas|montador electricista)\b/],
    ['MECANICA','mecánico',/\b(mecanic\w*|mecanizado|automotores?)\b/],
    ['ELECTRONICA','electrónico',/\b(electronic\w*)\b/],
    ['QUIMICA','químico',/\b(ingenieria quimica|tecnico quimico|quimica industrial|quimic\w*)\b/],
    ['INDUSTRIAL','industrial',/\b(ingenieria industrial|gestion industrial|procesos industriales|tecnico industrial)\b/],
    ['METALURGIA','metalúrgico',/\b(metalurg\w*|siderurg\w*)\b/],
    ['IT','sistemas / informática',/\b(sistemas de informacion|informatica|programacion|programador|desarrollo de software|computacion)\b/],
    ['CALIDAD_HSE','seguridad e higiene',/\b(seguridad e higiene|higiene y seguridad|tecnico en seguridad|hse)\b/],
    ['AMBIENTE','ambiental',/\b(gestion ambiental|medio ambiente|ambiental)\b/],
    ['LOGISTICA','logístico',/\b(logistica|comercio internacional|comercio exterior)\b/],
    ['ADMINISTRACION','administrativo',/\b(administracion|gestion publica|economia y gestion|economia|contabilidad|recursos humanos|rrhh)\b/],
    ['EDUCACION','educación',/\b(profesorado|docencia|educacion especial|educacion fisica)\b/],
    ['CONSTRUCCION','construcción',/\b(maestro mayor de obras|construccion|obra civil)\b/],
  ];
  const higherRules=[
    ['IT','sistemas / informática',/\b(ingenieria (?:en )?sistemas|licenciatura (?:en )?(?:sistemas|informatica)|analista programador|desarrollo de software)\b/],
    ['INDUSTRIAL','industrial',/\b(ingenieria industrial|tecnicatura superior en gestion industrial|tecnico superior en gestion industrial)\b/],
    ['QUIMICA','químico',/\b(ingenieria quimica|licenciatura en quimica|tecnicatura superior en quimica)\b/],
    ['ELECTRICA','eléctrico',/\b(ingenieria electrica|ingenieria electricista|tecnicatura superior electrica)\b/],
    ['ELECTROMECANICA','electromecánico',/\b(ingenieria electromecanica|tecnicatura superior electromecanica)\b/],
    ['MECANICA','mecánico',/\b(ingenieria mecanica|tecnicatura superior mecanica)\b/],
    ['ELECTRONICA','electrónico',/\b(ingenieria electronica|tecnicatura superior electronica)\b/],
    ['LOGISTICA','logístico',/\b(licenciatura (?:en )?(?:logistica|comercio internacional)|tecnicatura superior (?:en )?logistica)\b/],
    ['ADMINISTRACION','administrativo',/\b(licenciatura (?:en )?(?:administracion|gestion publica)|tecnicatura superior (?:en )?(?:administracion|gestion publica))\b/],
    ['EDUCACION','educación',/\b(profesorado|licenciatura en educacion)\b/],
  ];
  let hit=(higher ? higherRules.find(([, ,rx])=>rx.test(education)) : null) || rules.find(([, ,rx])=>rx.test(education));
  let orientationSource=hit?'FORMACION_ACADEMICA':'';
  // Si el CV no trae detalle de la formación, se admite la orientación elegida por
  // el candidato únicamente como señal secundaria y con confianza baja.
  if(!hit && declaredOrientation && !/\b(pendiente|otros?|no informado|sin dato)\b/.test(declaredOrientation)){
    hit=rules.find(([, ,rx])=>rx.test(declaredOrientation));
    if(hit) orientationSource='ORIENTACION_DECLARADA';
  }
  let expertiseKey=hit?.[0] || 'GENERAL';
  let orientation=hit?.[1] || '';
  // Regla de negocio v8: bachiller/secundario no técnico sin experiencia se presenta
  // como aprendiz administrativo, tal como fue definido para búsquedas empresariales.
  if(!hit && secondary && /\bbachiller\b/.test(education)){
    expertiseKey='ADMINISTRACION'; orientation='administrativo'; orientationSource='FORMACION_ACADEMICA';
  }
  const kind=higher?'PASANTE':'APRENDIZ';
  if(!orientation){
    if(kind==='PASANTE') orientation='general';
    else if(secondary) orientation='general';
    else orientation='estudios secundarios no declarados';
  }
  const prefix=kind==='PASANTE'?'Pasante':'Aprendiz';
  const displayLabel=orientation==='general' ? `${prefix} general` : (orientation==='estudios secundarios no declarados' ? 'Aprendiz – estudios secundarios no declarados' : `${prefix} ${orientation}`);
  const aliases=[prefix,displayLabel,orientation,rawEducation];
  if(kind==='APRENDIZ' && orientation==='administrativo') aliases.push('aprendiz administrativo','administrativo');
  if(kind==='PASANTE') aliases.push('pasantía','pasantia');
  return {kind,higher,secondary,expertiseKey,orientation,displayLabel,orientationSource,rawEducation,aliases:aliases.filter(Boolean)};
}

function buildCandidateAdminClassification(candidate = {}){
  const b=candidate.candidateBolsa || {}, r=candidate.resume || {};
  const ev=candidateVerifiedProfessionalEvidence(candidate);
  const ranked=candidateRankedWithRecency(ev);
  const recentBest=ranked.find((item)=>item.recentHits?.length);
  const currentDatedBest=ranked.find((item)=>item.role && item.task && (item.hits||[]).some((line)=>/\b(actualidad|presente|actual|hoy|current|present)\b/.test(adminNormText(line))));
  const currentDatedRoleBest=ranked.find((item)=>item.role && (item.hits||[]).some((line)=>/\b(actualidad|presente|actual|hoy|current|present)\b/.test(adminNormText(line))));
  const currentDatedTaskBest=ranked.find((item)=>item.task && (item.hits||[]).some((line)=>/\b(actualidad|presente|actual|hoy|current|present)\b/.test(adminNormText(line))));
  // Si el campo Último trabajo es genérico (p.ej. "operario industrial") pero el CV
  // declara un cargo actual fechado y con tareas concretas, prevalece este último.
  const recentGenericProduction=!!recentBest && recentBest.rule?.[0]==='PRODUCCION' && (recentBest.recentHits||[]).every((line)=>!/\b(produccion|planta|proceso|linea|manufactura|embalaje|envasado)\b/.test(adminNormText(line)));
  const recentSpecific=!!recentBest && !!recentBest.role && !recentGenericProduction;
  const best=(recentBest && (recentBest.task || recentSpecific || (!currentDatedBest && !currentDatedRoleBest && !currentDatedTaskBest))) ? recentBest : (currentDatedBest || currentDatedRoleBest || currentDatedTaskBest || recentBest || ranked[0]);
  const primaryFromRecent=!!best && (best===recentBest || best===currentDatedBest);
  const education=adminNormText(r.education || '');
  const technicalSchool=/\b(escuela tecnica|secundari\w* tecnic\w*|tecnico electromecanico|tecnico electric\w*|tecnico mecanico|tecnico electronico)\b/.test(education);
  let educationProfile=candidateEducationOrientation(candidate);
  const declaredApprentice=candidateDeclaredApprenticeOrientation(candidate);
  if(!best && educationProfile.kind==='APRENDIZ' && educationProfile.orientation==='estudios secundarios no declarados' && declaredApprentice){
    const label=`Aprendiz ${declaredApprentice.label}`;
    educationProfile={...educationProfile,expertiseKey:`APRENDIZ_${declaredApprentice.key}`,orientation:declaredApprentice.label,displayLabel:label,orientationSource:'SABER_DECLARADO',aliases:[...educationProfile.aliases,'aprendiz',label,declaredApprentice.label,...declaredApprentice.evidence],declaredPracticalEvidence:declaredApprentice.evidence,declaredPracticalSources:declaredApprentice.sources};
  }
  const allOriginal=adminNormText([b.ultimoTrabajo,b.voiceNarrativeRaw,r.experience].join(' '));
  const explicitFirst=/\b(primer empleo|sin experiencia laboral|sin experiencia previa|sin experiencia formal|no tengo experiencia laboral|(?:busco|buscando)\w*(?: \w+){0,4} pasantia)\b/.test(allOriginal);
  // v8.0.1: la ausencia de experiencia verificable es suficiente para entrar en
  // Aprendiz/Pasante; no exigimos que el candidato haya escrito literalmente "primer empleo".
  const first=!best && (explicitFirst || !ev.credibleWork.length);
  // v8.0.1: si no existe una actividad profesional suficientemente demostrada,
  // no dejamos al candidato en categorías ambiguas. La formación define una
  // situación de entrada: APRENDIZ para secundaria/no superior y PASANTE para
  // terciaria/universitaria, sin convertir estudios en experiencia laboral.
  const entryProfile=!best;
  let classKey=best?best.rule[3]:educationProfile.kind;
  let profileTitle=best?best.rule[2]:educationProfile.displayLabel;
  const recentRoleText=adminNormText(ev.recent.join(' '));
  if(!best && /\b(gerente|director|directora|socio gerente)\b/.test(recentRoleText)){classKey='GERENCIAL';profileTitle=ev.recent[0] || 'Gestión / Dirección';}
  else if(!best && /\b(supervisor|supervisora|jefe|jefa|capataz|coordinador|coordinadora|responsable de area)\b/.test(recentRoleText)){classKey='SUPERVISION';profileTitle=ev.recent[0] || 'Supervisión / Jefatura';}
  const primaryContextLines=[...new Set([...(ev.recent||[]),...(best?.hits||[])])];
  const responsibilities=primaryContextLines.filter(x=>/\b(personal a cargo|equipo a cargo|equipo de|cuadrilla|presupuesto|supervis\w*|dirigi\w*|lider\w*|coordino|coordinaba|coordinacion de equipo|responsable de area)\b/.test(adminNormText(x)));
  const roleText=adminNormText(primaryContextLines.join(' '));
  if(responsibilities.length && /\b(gerente|director|directora|socio gerente)\b/.test(roleText)){classKey='GERENCIAL';profileTitle='Gestión de equipos y operaciones';}
  else if(responsibilities.length && /\b(supervisor|supervisora|jefe|jefa|capataz|coordinador|coordinadora|responsable de area)\b/.test(roleText)){classKey='SUPERVISION';profileTitle=`Supervisión de ${best?best.rule[1].toLowerCase():'equipos y operaciones'}`;}
  let duration=candidateEvidenceYears(ev.credibleWork.length?ev.credibleWork:ev.lines);
  const nearbyPeriods=best?candidateNearbyRelevantPeriodLines(best,ev.work):[];
  let relevantDuration=candidateEvidenceYears(best?[...best.hits,...nearbyPeriods]:[]);
  // La experiencia relevante es también parte de la experiencia total. Si la
  // asociación temporal de la especialidad recupera un período que el barrido
  // general no pudo unir al bloque, el total nunca puede quedar por debajo.
  if(relevantDuration.years!==null && (duration.years===null || relevantDuration.years>duration.years)){
    duration={years:relevantDuration.years,dated:duration.dated || relevantDuration.dated};
  }
  const tasks=best?best.hits.filter(x=>best.rule[5].test(adminNormText(x))):[];
  let profileScore=null, seniorityKey='NO_DETERMINADO',seniorityLabel='Nivel por verificar';
  if(entryProfile){profileScore=educationProfile.kind==='PASANTE'?15:10;seniorityKey=educationProfile.kind;seniorityLabel=educationProfile.kind==='PASANTE'?'Pasante / formación superior':'Inicial / aprendizaje';}
  else if(best){
    // v8.0.1: indicador deliberadamente conservador. La actividad actual/reciente
    // Años en otros trabajos no transfieren automáticamente expertise a la actividad principal.
    // pesa más y la experiencia histórica nunca infla por sí sola el expertise principal.
    profileScore=best.role && best.task?25:15;
    if(primaryFromRecent && best.role && best.task) profileScore=35;
    if((best.role || tasks.length) && relevantDuration.years!==null){
      let durationScore=relevantDuration.years>=8?65:relevantDuration.years>=3?50:35;
      if(!primaryFromRecent) durationScore=Math.min(durationScore,45);
      profileScore=Math.max(profileScore,durationScore);
      if(primaryFromRecent && relevantDuration.years>=8 && best.role && tasks.length>=1 && best.hits.length>=2 && responsibilities.length) profileScore=Math.min(65,Math.max(profileScore,65));
      seniorityKey=profileScore>=60?'SENIOR':profileScore>=50?'SEMI_SENIOR':'JUNIOR';
      seniorityLabel=profileScore>=60?'Senior provisional':profileScore>=50?'Intermedio provisional':'Junior provisional';
    }
  }
  if(best && /\b(ayudante|auxiliar|aprendiz|asistente)\b/.test(adminNormText(ev.recent.join(' ') || best.hits.join(' ')))){
    profileTitle=`Auxiliar de ${best.rule[1].toLowerCase()}`;
    if(classKey!=='ADMINISTRATIVO') classKey='OPERATIVO';
    profileScore=Math.min(profileScore ?? 20,25);seniorityKey='JUNIOR';seniorityLabel='Junior / asistencia';
  }
  const expertiseKey=best?best.rule[0]:educationProfile.expertiseKey;
  const expertiseLabel=best?best.rule[1]:educationProfile.displayLabel;
  const evidence=best?best.hits.slice(0,3):ev.credibleWork.slice(0,3);
  const secondaryProfiles=candidateSecondaryProfiles(ranked,best);
  const gaps=[];
  if(!best && ev.credibleWork.length) gaps.push('Hay antecedentes laborales declarados, pero no alcanzan para definir un expertise profesional; el perfil se clasifica por su nivel y orientación formativa.');
  else if(!best && educationProfile.orientationSource==='SABER_DECLARADO') gaps.push('No se declaró formación suficiente ni experiencia profesional verificable; la orientación de Aprendiz surge de tareas o saberes expresamente mencionados por la persona.');
  else if(!best && educationProfile.orientation==='estudios secundarios no declarados') gaps.push('No se declararon estudios secundarios, experiencia laboral verificable ni saberes prácticos suficientes para orientar el perfil.');
  else if(!best) gaps.push('Sin experiencia profesional verificable; la clasificación se apoya exclusivamente en la formación declarada.');
  if(best && relevantDuration.years===null) gaps.push('Falta duración verificable en la especialidad.');
  if(best && !best.task) gaps.push('El cargo está declarado, pero faltan tareas que demuestren el dominio.');
  const primaryOrigin=primaryFromRecent?'actividad actual o último trabajo declarado':'antecedentes curriculares disponibles';
  const reason=best?`Actividad principal propuesta: ${expertiseLabel}. Se prioriza ${primaryOrigin}. Evidencia utilizada: ${evidence.map(x=>x.slice(0,180)).join(' / ')}.`:(educationProfile.kind==='PASANTE'?`No hay una actividad profesional suficientemente demostrada. La formación superior declarada permite clasificar el perfil como ${educationProfile.displayLabel}.`:(educationProfile.orientationSource==='SABER_DECLARADO'?`No hay experiencia profesional suficientemente demostrada ni formación que defina una especialidad. La persona sí declaró tareas o saberes prácticos compatibles con ${educationProfile.displayLabel}; se usa esa orientación sólo como categoría de aprendizaje y búsqueda.`:(educationProfile.orientation==='estudios secundarios no declarados'?`No hay experiencia, formación ni saberes prácticos suficientes para orientar una especialidad. Se conserva ${educationProfile.displayLabel} sin inventar conocimientos.`:`No hay una actividad profesional suficientemente demostrada. La formación u orientación declarada permite clasificar el perfil como ${educationProfile.displayLabel}.`)));

  const confidence=best && primaryFromRecent && best.role && best.task && relevantDuration.dated?'ALTA':(best && (primaryFromRecent || (best.role && best.task))?'MEDIA':(entryProfile && educationProfile.orientationSource==='FORMACION_ACADEMICA'?'MEDIA':'BAJA')); // saber práctico declarado sigue siendo BAJA: orienta búsqueda, no certifica expertise
  const searchableSecondary=(confidence==='BAJA'?[]:secondaryProfiles.filter((item)=>item.searchable));
  return {classKey,classLabel:ADMIN_CANDIDATE_CLASS_LABELS[classKey],expertiseKey,expertiseLabel,expertiseSource:'EVIDENCIA_PRIORIZADA_V802',profileTitle,
    recentRole:ev.recent[0] || ev.credibleWork[0] || '',profileScore,seniorityKey,seniorityLabel,explicitYearsExperience:duration.years,
    relevantYearsExperience:relevantDuration.years,experienceEvidenceSource:duration.years===null?'Sin duración verificable':(duration.dated?'Períodos laborales declarados (aproximación temporal)':'Duración explícita en antecedentes laborales'),
    professionalSourcesUsed:[...(ev.recent.length?['Último trabajo declarado']:[]),...(ev.work.length?['CV / antecedentes curriculares']:[]),...(ev.voice.length?['Relato original']:[]),...(!best && educationProfile.rawEducation?['Formación académica declarada']:[]),...(!best && educationProfile.orientationSource==='SABER_DECLARADO'?['Saberes / tareas declaradas por el candidato']:[])],cvEvidenceUsed:ev.work.length>0,
    classificationConfidence:confidence,firstEmploymentExplicit:first,secondaryProfiles,primaryFromRecent,
    professionalEvidenceSummary:{rolesDetected:best?.role?1:0,responsibilitySignals:responsibilities.length,leadershipSignals:responsibilities.length,credibleWorkSignals:ev.credibleWork.length,richResume:false,richPresentation:false},
    reason,scoreBasis:profileScore===null?'Sin evidencia suficiente para puntuar.':`${profileScore}/100: indicador conservador de evidencia en la actividad principal; no mide empleabilidad.`,
    evidence,gaps,assessment:`${reason} ${secondaryProfiles.length?`Perfil(es) complementario(s): ${secondaryProfiles.map(x=>x.label).join(' / ')}. `:''}${gaps.join(' ')} Confirmar funciones y autonomía en entrevista.`,
    searchText:[profileTitle,expertiseLabel,seniorityLabel,...(entryProfile?educationProfile.aliases:[]),ev.recent?.[0]||'',...evidence,...searchableSecondary.flatMap(x=>[x.label,x.profileTitle,...(x.evidence||[])])].join(' '),classificationVersion:'8.0.4'};
}


function candidateQuickFacts(candidate={}, now=new Date()){
  const b=candidate.candidateBolsa || {},p=candidate.candidateProfile || {},r=candidate.resume || {};
  const clean=v=>/^(pendiente|s\/d|sin dato|no informado)$/i.test(String(v||'').trim())?'':String(v||'').trim();
  let birth=clean(b.fechaNacimiento),source=birth?'Fecha declarada':'';
  if(!birth){const m=[r.observations,r.summary,r.experience].filter(Boolean).join('\n').match(/(?:fecha de nacimiento|nacimiento|naci[oó])\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);if(m){birth=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;source='Fecha extraída del CV; confirmar';}}
  let age=null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(birth)){
    const date=new Date(birth+'T12:00:00Z');
    if(Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===birth){
      age=now.getUTCFullYear()-date.getUTCFullYear()-((now.getUTCMonth()<date.getUTCMonth() || (now.getUTCMonth()===date.getUTCMonth() && now.getUTCDate()<date.getUTCDate()))?1:0);
      if(age<0 || age>110) age=null;
    }
  }
  const originalPersonalText=[r.observations,r.experience].filter(Boolean).join('\n');
  if(age===null && !birth){
    const declared=originalPersonalText.match(/\bedad\s*[:\-]?\s*(\d{1,3})\s*(?:a[ñn]os)?\b/i);
    if(declared && Number(declared[1])<=110){age=Number(declared[1]);source='Edad declarada en CV; confirmar vigencia';}
  }
  const extraPhone=originalPersonalText.match(/(?:tel[eé]fono adicional|tel[eé]fono alternativo|celular alternativo)\s*[:\-]?\s*([+()\d][()\d +.-]{5,35})/i)?.[1]?.trim() || '';
  const city=clean(b.localidad || p.city);
  const cityMap={campana:'Campana',zarate:'Zárate',escobar:'Escobar',tigre:'Tigre',pilar:'Pilar',baradero:'Baradero','san pedro':'San Pedro','san nicolas':'San Nicolás','exaltacion de la cruz':'Exaltación de la Cruz','malvinas argentinas':'Malvinas Argentinas'};
  const phone=clean(b.telefono || p.phone);
  return {phone,additionalPhone:clean(b.telefonoAdicional)||extraPhone|| (clean(p.phone)!==phone?clean(p.phone):''),address:clean(b.direccion || p.address),city:cityMap[adminNormText(city)] || city,
    maritalStatus:clean(b.estadoCivil),age,birthDate:age!==null?birth:'',ageSource:age!==null?source:'No informada',latestJob:clean(b.ultimoTrabajo),email:clean(b.correo || candidate.email)};
}
function candidateProfessionalSearchText(candidate={}, classification=buildCandidateAdminClassification(candidate)){
  const b=candidate.candidateBolsa || {},p=candidate.candidateProfile || {},r=candidate.resume || {};
  const declaredQualificationText=[
    b.voiceNarrativeProfessionalTitle,
    p.headline,
    r.education,
    r.certifications,
  ].filter(Boolean).join(' ');
  const qualificationNorm=adminNormText(declaredQualificationText);
  const qualificationAliases=[];
  if(/\bingenier/.test(qualificationNorm)) qualificationAliases.push('ingeniero','ingeniera','ingenieria');
  if(/\btecnic/.test(qualificationNorm)) qualificationAliases.push('tecnico','tecnica','tecnicatura');
  if(/\blicenciad|\blicenciatur/.test(qualificationNorm)) qualificationAliases.push('licenciado','licenciada','licenciatura');
  if(/\barquitect/.test(qualificationNorm)) qualificationAliases.push('arquitecto','arquitecta','arquitectura');
  if(/\bcontador|\bcontadora|\bcontabilidad/.test(qualificationNorm)) qualificationAliases.push('contador','contadora','contabilidad');
  return [candidate.email,b.nombre,b.apellido,b.dni,b.correo,b.localidad,b.provinciaResidencia,b.paisResidencia,p.fullName,p.dni,p.city,p.province,classification.searchText,declaredQualificationText,...qualificationAliases].filter(Boolean).join(' ');
}

function buildAdminComposition(candidateItems = [], companyItems = []){
  const countBy = (items, keyField, labelField) => {
    const map = new Map();
    for(const item of items || []){
      const key = String(item?.[keyField] || 'GENERAL');
      const label = String(item?.[labelField] || 'General');
      const current = map.get(key) || { key, label, count:0 };
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
  };
  const residenceMap = new Map();
  for(const item of candidateItems || []){
    const country=String(item?.residenceCountry || 'País no informado');
    const province=String(item?.residenceProvince || item?.province || 'Provincia / región no informada');
    const city=String(item?.residenceCity || item?.localidad || 'Ciudad no informada');
    const key=`${adminNormText(country)}|${adminNormText(province)}|${adminNormText(city)}`;
    const row=residenceMap.get(key) || { key, label:`${country} · ${province} · ${city}`, country, province, city, count:0 };
    row.count += 1;
    residenceMap.set(key,row);
  }
  return {
    candidatesByExpertise:countBy(candidateItems, 'expertiseKey', 'expertiseLabel'),
    candidatesByResidence:[...residenceMap.values()].sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label,'es')),
    companiesByActivity:countBy(companyItems, 'activityKey', 'activityLabel'),
    companiesByFamily:countBy(companyItems, 'categoryKey', 'categoryLabel'),
  };
}


function traceabilityCountBy(items = [], keyField, labelField){
  const map = new Map();
  for(const item of items || []){
    const key = String(item?.[keyField] || 'GENERAL');
    const label = String(item?.[labelField] || 'General');
    const row = map.get(key) || { key, label, count:0 };
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}


function candidateResidence(candidate = {}){
  const bolsa=candidate.candidateBolsa || {};
  const profile=candidate.candidateProfile || {};
  return normalizeResidenceForGrouping({
    locality:bolsa.localidad || profile.city || '',
    province:bolsa.provinciaResidencia || profile.province || '',
    country:bolsa.paisResidencia || profile.country || '',
    alternateLocality:profile.city || bolsa.localidad || '',
    alternateProvince:profile.province || bolsa.provinciaResidencia || '',
    alternateCountry:profile.country || bolsa.paisResidencia || '',
    address:bolsa.direccion || profile.address || '',
    alternateAddress:profile.address || bolsa.direccion || '',
  });
}

function candidateResidenceCountry(candidate = {}){
  return candidateResidence(candidate).country || 'País no informado';
}


function buildCandidateResidenceComposition(candidateRows = []){
  const map=new Map();
  for(const item of candidateRows || []){
    const country=candidateResidenceCountry(item);
    const residence=candidateResidence(item);
    const province=String(residence.province || item?.candidateBolsa?.provinciaResidencia || item?.candidateProfile?.province || 'Provincia / región no informada').trim() || 'Provincia / región no informada';
    const city=String(residence.city || item?.candidateBolsa?.localidad || item?.candidateProfile?.city || 'Ciudad no informada').trim() || 'Ciudad no informada';
    const key=`${adminNormText(country)}|${adminNormText(province)}|${adminNormText(city)}`;
    const row=map.get(key) || { key, country, province, city, label:`${country} · ${province} · ${city}`, count:0 };
    row.count += 1;
    map.set(key,row);
  }
  return [...map.values()].sort((a,b)=>b.count-a.count || a.country.localeCompare(b.country,'es') || a.province.localeCompare(b.province,'es') || a.city.localeCompare(b.city,'es'));
}

function traceabilityMonthKey(value){
  const d = value ? new Date(value) : null;
  if(!d || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit' }).formatToParts(d);
  const year = parts.find((p)=>p.type === 'year')?.value;
  const month = parts.find((p)=>p.type === 'month')?.value;
  return year && month ? `${year}-${month}` : null;
}

function buildTraceabilityMonthlySeries({ candidateRows=[], companyRows=[], jobRows=[], applicationRows=[] } = {}){
  const maps = [candidateRows, companyRows, jobRows, applicationRows].map((rows) => {
    const m = new Map();
    for(const row of rows || []){
      const key = traceabilityMonthKey(row?.createdAt);
      if(key) m.set(key, Number(m.get(key) || 0) + 1);
    }
    return m;
  });
  const now = new Date();
  const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit' }).formatToParts(now);
  let year = Number(nowParts.find((p)=>p.type === 'year')?.value || now.getUTCFullYear());
  let month = Number(nowParts.find((p)=>p.type === 'month')?.value || (now.getUTCMonth()+1)) - 5;
  while(month <= 0){ month += 12; year -= 1; }
  const out=[];
  for(let i=0;i<6;i++){
    const key=`${year}-${String(month).padStart(2,'0')}`;
    const labelDate = new Date(Date.UTC(year, month-1, 15, 12, 0, 0));
    out.push({
      key,
      label:labelDate.toLocaleDateString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',month:'long',year:'numeric'}),
      candidates:Number(maps[0].get(key)||0),
      companies:Number(maps[1].get(key)||0),
      jobs:Number(maps[2].get(key)||0),
      applications:Number(maps[3].get(key)||0),
    });
    month += 1;
    if(month > 12){ month = 1; year += 1; }
  }
  return out;
}

async function buildTraceabilityReportSnapshot(){
  const now = new Date();
  const since30 = new Date(now.getTime() - 30*24*60*60*1000);
  const since60 = new Date(now.getTime() - 60*24*60*60*1000);
  const since6Months = new Date(now.getFullYear(), now.getMonth()-5, 1);

  const [
    candidateCount, companyCount, jobsCount, publishedJobsCount, applicationCount,
    candidatesLast30, candidatesPrevious30, companiesLast30, companiesPrevious30,
    jobsLast30, jobsPrevious30, applicationsLast30, applicationsPrevious30,
    openingsLast30, openingsPrevious30, candidateChatsLast30, candidateChatsPrevious30,
    companyChatsLast30, companyChatsPrevious30, candidatesUpdatedLast30, companiesUpdatedLast30,
    candidateRows, companyRows, candidateTimeline, companyTimeline, jobTimeline, applicationTimeline,
  ] = await Promise.all([
    prisma.user.count({ where:{ role:'CANDIDATE' } }).catch(()=>0),
    prisma.companyProfile.count().catch(()=>0),
    prisma.job.count().catch(()=>0),
    prisma.job.count({ where:{ status:'PUBLISHED' } }).catch(()=>0),
    prisma.application.count().catch(()=>0),
    prisma.user.count({ where:{ role:'CANDIDATE', createdAt:{ gte:since30 } } }).catch(()=>0),
    prisma.user.count({ where:{ role:'CANDIDATE', createdAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.user.count({ where:{ role:'COMPANY', createdAt:{ gte:since30 } } }).catch(()=>0),
    prisma.user.count({ where:{ role:'COMPANY', createdAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.job.count({ where:{ createdAt:{ gte:since30 } } }).catch(()=>0),
    prisma.job.count({ where:{ createdAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.application.count({ where:{ createdAt:{ gte:since30 } } }).catch(()=>0),
    prisma.application.count({ where:{ createdAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.companyCandidateAccess.count({ where:{ createdAt:{ gte:since30 } } }).catch(()=>0),
    prisma.companyCandidateAccess.count({ where:{ createdAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.supportThread.count({ where:{ role:'CANDIDATE', updatedAt:{ gte:since30 } } }).catch(()=>0),
    prisma.supportThread.count({ where:{ role:'CANDIDATE', updatedAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.supportThread.count({ where:{ role:'COMPANY', updatedAt:{ gte:since30 } } }).catch(()=>0),
    prisma.supportThread.count({ where:{ role:'COMPANY', updatedAt:{ gte:since60, lt:since30 } } }).catch(()=>0),
    prisma.user.count({ where:{ role:'CANDIDATE', OR:[{ candidateProfile:{ is:{ updatedAt:{ gte:since30 } } } },{ candidateBolsa:{ is:{ updatedAt:{ gte:since30 } } } },{ resume:{ is:{ updatedAt:{ gte:since30 } } } }] } }).catch(()=>0),
    prisma.companyProfile.count({ where:{ updatedAt:{ gte:since30 } } }).catch(()=>0),
    prisma.user.findMany({
      where:{ role:'CANDIDATE' },
      select:{
        id:true, createdAt:true,
        candidateProfile:{ select:{ fullName:true, dni:true, city:true, province:true, country:true, address:true, headline:true, sector:true, subSector:true, updatedAt:true } },
        candidateBolsa:{ select:{ nombre:true, apellido:true, dni:true, correo:true, localidad:true, provinciaResidencia:true, paisResidencia:true, direccion:true, nacionalidad:true, areaTrabajo:true, nivel:true, especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true, tieneCapacitacion:true, trabajaActualmente:true, ultimoTrabajo:true, observaciones:true, voiceNarrativeRaw:true, voiceNarrativeSummary:true, voiceNarrativeAnalysisVersion:true, voiceNarrativeAnalysisSource:true, voiceNarrativeYears:true, voiceNarrativeProfessionalTitle:true, voiceNarrativeStrengths:true, voiceNarrativeMotivation:true, voiceNarrativeClosing:true, voiceNarrativeAnalyzedAt:true, updatedAt:true } },
        resume:{ select:{ summary:true, experience:true, education:true, certifications:true, observations:true, updatedAt:true } },
      },
    }).catch(()=>[]),
    prisma.companyProfile.findMany({
      select:{
        id:true, companyName:true, companySummary:true, website:true, adminCategory:true, createdAt:true, updatedAt:true,
        jobs:{ select:{ title:true, description:true, requirements:true, location:true }, orderBy:{ createdAt:'desc' }, take:20 },
      },
    }).catch(()=>[]),
    prisma.user.findMany({ where:{ role:'CANDIDATE', createdAt:{ gte:since6Months } }, select:{ createdAt:true } }).catch(()=>[]),
    prisma.user.findMany({ where:{ role:'COMPANY', createdAt:{ gte:since6Months } }, select:{ createdAt:true } }).catch(()=>[]),
    prisma.job.findMany({ where:{ createdAt:{ gte:since6Months } }, select:{ createdAt:true } }).catch(()=>[]),
    prisma.application.findMany({ where:{ createdAt:{ gte:since6Months } }, select:{ createdAt:true } }).catch(()=>[]),
  ]);

  const candidateItems=(candidateRows || []).map((it)=>({ ...buildCandidateAdminClassification(it) }));
  const companyItems=(companyRows || []).map((it)=>{
    const c=inferAdminCompanyCategory(it);
    return { categoryKey:c.key, categoryLabel:c.label, activityKey:c.activityKey || 'ACTIVIDAD_NO_ESPECIFICADA', activityLabel:c.activityLabel || 'Actividad principal no especificada' };
  });
  const candidatesWithCv=(candidateRows || []).filter((it)=>{
    const r=it.resume || {}, b=it.candidateBolsa || {};
    return [r.summary,r.experience,r.education,r.certifications,r.observations,b.observaciones].some((v)=>String(v||'').trim());
  }).length;
  const candidatesWithProfessionalProfile=(candidateRows || []).filter((it)=>{
    const r=it.resume || {}, b=it.candidateBolsa || {}, p=it.candidateProfile || {};
    return [b.areaTrabajo,b.especialidad,b.especialidadOtro,b.ultimoTrabajo,b.voiceNarrativeSummary,p.headline,r.summary,r.experience].some((v)=>String(v||'').trim());
  }).length;
  const candidatesWithPresentation=(candidateRows || []).filter((it)=>String(it?.candidateBolsa?.voiceNarrativeSummary || '').trim()).length;
  const candidatesWithResidenceCountry=(candidateRows || []).filter((it)=>candidateResidenceCountry(it) !== 'País no informado').length;
  const candidatesWithResidenceProvince=(candidateRows || []).filter((it)=>{ const p=String(candidateResidence(it).province || '').trim(); return p && p !== 'Provincia / región no informada'; }).length;
  const composition={
    candidatesByClass:traceabilityCountBy(candidateItems,'classKey','classLabel'),
    candidatesByExpertise:traceabilityCountBy(candidateItems,'expertiseKey','expertiseLabel'),
    candidatesByResidence:buildCandidateResidenceComposition(candidateRows),
    companiesByFamily:traceabilityCountBy(companyItems,'categoryKey','categoryLabel'),
    companiesByActivity:traceabilityCountBy(companyItems,'activityKey','activityLabel'),
  };
  const snapshot={
    generatedAt:now.toISOString(),
    summary:{ candidateCount, companyCount, jobsCount, publishedJobsCount, applicationCount },
    activity:{
      candidatesLast30,candidatesPrevious30,companiesLast30,companiesPrevious30,
      jobsLast30,jobsPrevious30,applicationsLast30,applicationsPrevious30,
      openingsLast30,openingsPrevious30,candidateChatsLast30,candidateChatsPrevious30,
      companyChatsLast30,companyChatsPrevious30,candidatesUpdatedLast30,companiesUpdatedLast30,
    },
    quality:{
      candidatesWithCv,
      candidatesWithProfessionalProfile,
      candidatesWithPresentation,
      candidatesWithResidenceCountry,
      candidatesWithResidenceProvince,
      cvCoveragePct:candidateCount ? Math.round((candidatesWithCv/candidateCount)*100) : 0,
      profileCoveragePct:candidateCount ? Math.round((candidatesWithProfessionalProfile/candidateCount)*100) : 0,
      presentationCoveragePct:candidateCount ? Math.round((candidatesWithPresentation/candidateCount)*100) : 0,
      residenceCoveragePct:candidateCount ? Math.round((candidatesWithResidenceCountry/candidateCount)*100) : 0,
      residenceProvinceCoveragePct:candidateCount ? Math.round((candidatesWithResidenceProvince/candidateCount)*100) : 0,
    },
    composition,
    monthlySeries:buildTraceabilityMonthlySeries({ candidateRows:candidateTimeline, companyRows:companyTimeline, jobRows:jobTimeline, applicationRows:applicationTimeline }),
  };
  snapshot.narrative=buildTraceabilityNarrative(snapshot);
  return snapshot;
}

const adminCompanyCategorySchema = z.object({
  category: z.enum(['FABRICACION','LOGISTICA','SERVICIO']).nullable().optional(),
});

// ============================
// Clasificación automática persistente de candidatos · v7.10.3
// ============================
// Objetivo operativo: cualquier candidato que ingrese por registro, carga de CV,
// actualización del perfil o importación externa (por ejemplo Ecoempleo) debe pasar
// por el mismo motor calibrado, sin depender de una auditoría manual posterior.

const CANDIDATE_CLASSIFICATION_ROW_SELECT = {
  id:true, email:true, role:true, createdAt:true,
  candidateProfile:{ select:{
    fullName:true, dni:true, city:true, province:true, country:true,
    headline:true, sector:true, subSector:true, updatedAt:true,
  } },
  candidateBolsa:{ select:{
    areaTrabajo:true, nivel:true, especialidad:true, especialidadOtro:true,
    rangoExperiencia:true, nivelEducativo:true, tieneCapacitacion:true,
    trabajaActualmente:true, ultimoTrabajo:true, observaciones:true,
    voiceNarrativeRaw:true, voiceNarrativeSummary:true,
    voiceNarrativeAnalysisVersion:true, voiceNarrativeAnalysisSource:true,
    voiceNarrativeYears:true, voiceNarrativeProfessionalTitle:true,
    voiceNarrativeStrengths:true, voiceNarrativeMotivation:true,
    voiceNarrativeClosing:true, voiceNarrativeAnalyzedAt:true,
    updatedAt:true,
  } },
  resume:{ select:{
    summary:true, experience:true, education:true, certifications:true,
    observations:true, updatedAt:true,
  } },
  candidateClassification:{ select:{
    classificationVersion:true, sourceFingerprint:true, classifiedAt:true,
  } },
};

function candidateClassificationSourcePayload(candidate={}){
  const b=candidate.candidateBolsa || {};
  const p=candidate.candidateProfile || {};
  const r=candidate.resume || {};
  // No se incluyen contraseña, seguridad, foto, facturación ni campos ajenos a la
  // clasificación. El fingerprint cambia sólo cuando cambia material profesional.
  return {
    profile:{ headline:p.headline || '', sector:p.sector || '', subSector:p.subSector || '' },
    bolsa:{
      areaTrabajo:b.areaTrabajo || '', nivel:b.nivel || '', especialidad:b.especialidad || '',
      especialidadOtro:b.especialidadOtro || '', rangoExperiencia:b.rangoExperiencia || '',
      nivelEducativo:b.nivelEducativo || '', tieneCapacitacion:!!b.tieneCapacitacion,
      trabajaActualmente:!!b.trabajaActualmente, ultimoTrabajo:b.ultimoTrabajo || '',
      observaciones:b.observaciones || '', voiceNarrativeRaw:b.voiceNarrativeRaw || '',
      // Los campos derivados/generados (summary, title, strengths, etc.) no forman parte
      // del fingerprint: una reescritura de IA no debe aparentar nueva experiencia.
    },
    resume:{
      summary:r.summary || '', experience:r.experience || '', education:r.education || '',
      certifications:r.certifications || '', observations:r.observations || '',
    },
  };
}

function candidateClassificationFingerprint(candidate={}){
  return crypto.createHash('sha256')
    .update(JSON.stringify(candidateClassificationSourcePayload(candidate)))
    .digest('hex');
}

function candidateClassificationSourceUpdatedAt(candidate={}){
  const values=[candidate.createdAt,candidate.candidateProfile?.updatedAt,candidate.candidateBolsa?.updatedAt,candidate.resume?.updatedAt]
    .filter(Boolean).map((v)=>new Date(v).getTime()).filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)) : null;
}

function candidateClassificationPersistenceData(candidate, classification, triggerSource, fingerprint){
  return {
    classificationVersion:CANDIDATE_CLASSIFICATION_VERSION,
    sourceFingerprint:fingerprint,
    classKey:String(classification.classKey || 'APRENDIZ'),
    classLabel:String(classification.classLabel || 'Aprendices'),
    expertiseKey:String(classification.expertiseKey || 'GENERAL'),
    expertiseLabel:String(classification.expertiseLabel || 'Aprendiz general'),
    expertiseSource:String(classification.expertiseSource || 'EVIDENCIA_DECLARADA').slice(0,120),
    profileTitle:String(classification.profileTitle || 'Aprendiz general').slice(0,240),
    recentRole:String(classification.recentRole || '').slice(0,500) || null,
    profileScore:classification.profileScore != null && Number.isFinite(Number(classification.profileScore)) ? Math.round(Number(classification.profileScore)) : null,
    seniorityKey:String(classification.seniorityKey || 'NO_DETERMINADO'),
    seniorityLabel:String(classification.seniorityLabel || 'Nivel por verificar'),
    explicitYearsExperience:classification.explicitYearsExperience != null && Number.isFinite(Number(classification.explicitYearsExperience)) ? Number(classification.explicitYearsExperience) : null,
    relevantYearsExperience:classification.relevantYearsExperience != null && Number.isFinite(Number(classification.relevantYearsExperience)) ? Number(classification.relevantYearsExperience) : null,
    experienceEvidenceSource:String(classification.experienceEvidenceSource || '').slice(0,500) || null,
    professionalSourcesUsed:Array.isArray(classification.professionalSourcesUsed) ? classification.professionalSourcesUsed.slice(0,12) : [],
    cvEvidenceUsed:!!classification.cvEvidenceUsed,
    classificationConfidence:String(classification.classificationConfidence || 'BAJA').slice(0,40),
    secondaryProfiles:Array.isArray(classification.secondaryProfiles) ? classification.secondaryProfiles.slice(0,3) : [],
    reason:String(classification.reason || '').slice(0,8000) || null,
    scoreBasis:String(classification.scoreBasis || '').slice(0,1200) || null,
    evidence:Array.isArray(classification.evidence) ? classification.evidence.slice(0,8).map((x)=>String(x).slice(0,1200)) : [],
    gaps:Array.isArray(classification.gaps) ? classification.gaps.slice(0,8).map((x)=>String(x).slice(0,1200)) : [],
    assessment:String(classification.assessment || '').slice(0,10000) || null,
    // No duplicamos todo el CV en esta tabla: el texto completo sigue en Resume.
    searchText:null,
    triggerSource:String(triggerSource || 'AUTO').slice(0,80),
    sourceUpdatedAt:candidateClassificationSourceUpdatedAt(candidate),
    classifiedAt:new Date(),
  };
}

async function persistCandidateClassificationRows(rows=[], {trigger='AUTO', force=false}={}){
  const pending=[];
  let skipped=0, errors=0;
  for(const candidate of rows || []){
    if(!candidate?.id || String(candidate.role || '').toUpperCase()!=='CANDIDATE') continue;
    const fingerprint=candidateClassificationFingerprint(candidate);
    const cached=candidate.candidateClassification || null;
    const fresh=!force && cached?.classificationVersion===CANDIDATE_CLASSIFICATION_VERSION && cached?.sourceFingerprint===fingerprint;
    if(fresh){ skipped++; continue; }
    try{
      const classification=buildCandidateAdminClassification(candidate);
      pending.push({
        userId:candidate.id,
        data:candidateClassificationPersistenceData(candidate, classification, trigger, fingerprint),
      });
    }catch(err){
      errors++;
      console.error('CANDIDATE_CLASSIFICATION_BUILD', candidate.id, err?.message || err);
    }
  }

  let classified=0;
  for(let offset=0; offset<pending.length; offset+=CANDIDATE_CLASSIFICATION_BATCH_SIZE){
    const chunk=pending.slice(offset,offset+CANDIDATE_CLASSIFICATION_BATCH_SIZE);
    const operations=chunk.map((item)=>prisma.candidateClassification.upsert({
      where:{ userId:item.userId },
      update:item.data,
      create:{ userId:item.userId, ...item.data },
    }));
    try{
      await prisma.$transaction(operations);
      classified += chunk.length;
    }catch(batchErr){
      // Un registro defectuoso no debe frenar los otros 499 de una importación.
      console.error('CANDIDATE_CLASSIFICATION_BATCH', batchErr?.message || batchErr);
      for(const item of chunk){
        try{
          await prisma.candidateClassification.upsert({
            where:{ userId:item.userId }, update:item.data, create:{ userId:item.userId, ...item.data },
          });
          classified++;
        }catch(err){
          errors++;
          console.error('CANDIDATE_CLASSIFICATION_ROW', item.userId, err?.message || err);
        }
      }
    }
  }
  return { scanned:(rows || []).length, classified, skipped, errors };
}

function queueCandidateClassification(userId, trigger='EVENT'){
  const id=String(userId || '').trim();
  if(!id || !CANDIDATE_CLASSIFICATION_AUTO_ENABLED) return;
  candidateClassificationPending.set(id,String(trigger || 'EVENT').slice(0,80));
  if(candidateClassificationQueueKickScheduled) return;
  candidateClassificationQueueKickScheduled=true;
  const timer=setTimeout(()=>{
    candidateClassificationQueueKickScheduled=false;
    processAutomaticCandidateClassificationsOnce('EVENT_QUEUE',{queueOnly:true}).catch((err)=>{
      console.error('CANDIDATE_CLASSIFICATION_QUEUE',err?.message || err);
    });
  },250);
  if(typeof timer.unref==='function') timer.unref();
}

async function processAutomaticCandidateClassificationsOnce(trigger='AUTO_INTERVAL', options={}){
  if(candidateClassificationWorkerBusy) return {ok:true,busy:true,...candidateClassificationRuntime};
  if(!CANDIDATE_CLASSIFICATION_AUTO_ENABLED && !options.manual) return {ok:true,disabled:true,...candidateClassificationRuntime};
  candidateClassificationWorkerBusy=true;
  candidateClassificationRuntime.running=true;
  candidateClassificationRuntime.lastTrigger=trigger;
  candidateClassificationRuntime.lastStartedAt=new Date().toISOString();
  candidateClassificationRuntime.lastError=null;
  const startedMs=Date.now();
  const scanStartedAt=new Date();
  try{
    const queued=[...candidateClassificationPending.keys()];
    const fullSweepIntervalMs=CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS*60*60*1000;
    const periodicFullSweepDue=!options.queueOnly && (!candidateClassificationLastFullSweepAt || (Date.now()-candidateClassificationLastFullSweepAt.getTime())>=fullSweepIntervalMs);
    // El barrido periódico completo es la red de seguridad para importaciones externas
    // (por ejemplo Ecoempleo) que preserven fechas antiguas y no pasen por los hooks API.
    const fullSweep=!!options.fullSweep || (!candidateClassificationLastScanAt && !options.queueOnly) || periodicFullSweepDue;
    let rows=[];
    if(fullSweep){
      rows=await prisma.user.findMany({
        where:{ role:'CANDIDATE' }, select:CANDIDATE_CLASSIFICATION_ROW_SELECT, orderBy:{ createdAt:'asc' },
      });
    }else{
      const OR=[];
      if(queued.length) OR.push({ id:{ in:queued } });
      if(!options.queueOnly){
        const overlapMs=Math.max(120000,CANDIDATE_CLASSIFICATION_SCAN_SECONDS*2000);
        const since=new Date(candidateClassificationLastScanAt.getTime()-overlapMs);
        OR.push(
          { createdAt:{ gte:since } },
          { candidateProfile:{ is:{ updatedAt:{ gte:since } } } },
          { candidateBolsa:{ is:{ updatedAt:{ gte:since } } } },
          { resume:{ is:{ updatedAt:{ gte:since } } } },
        );
      }
      if(OR.length){
        rows=await prisma.user.findMany({
          where:{ role:'CANDIDATE', OR }, select:CANDIDATE_CLASSIFICATION_ROW_SELECT, orderBy:{ createdAt:'asc' },
        });
      }
    }

    const result=await persistCandidateClassificationRows(rows,{trigger,force:!!options.force});
    for(const id of queued) candidateClassificationPending.delete(id);
    if(!options.queueOnly) candidateClassificationLastScanAt=scanStartedAt;
    if(fullSweep) candidateClassificationLastFullSweepAt=scanStartedAt;
    candidateClassificationRuntime.lastScanned=result.scanned;
    candidateClassificationRuntime.lastClassified=result.classified;
    candidateClassificationRuntime.lastSkipped=result.skipped;
    candidateClassificationRuntime.lastErrors=result.errors;
    candidateClassificationRuntime.totalClassifiedSinceBoot += result.classified;
    candidateClassificationRuntime.lastCompletedAt=new Date().toISOString();
    candidateClassificationRuntime.lastDurationMs=Date.now()-startedMs;
    return {ok:result.errors===0, ...result, pendingQueue:candidateClassificationPending.size};
  }catch(err){
    candidateClassificationRuntime.lastErrors=1;
    candidateClassificationRuntime.lastError=String(err?.message || err).slice(0,1000);
    candidateClassificationRuntime.lastCompletedAt=new Date().toISOString();
    candidateClassificationRuntime.lastDurationMs=Date.now()-startedMs;
    console.error('CANDIDATE_CLASSIFICATION_WORKER',err?.message || err);
    return {ok:false,error:candidateClassificationRuntime.lastError,pendingQueue:candidateClassificationPending.size};
  }finally{
    candidateClassificationWorkerBusy=false;
    candidateClassificationRuntime.running=false;
  }
}

async function candidateClassificationStatusSummary(){
  const [totalCandidates,cachedAny,cachedCurrent]=await Promise.all([
    prisma.user.count({where:{role:'CANDIDATE'}}).catch(()=>0),
    prisma.candidateClassification.count().catch(()=>0),
    prisma.candidateClassification.count({where:{classificationVersion:CANDIDATE_CLASSIFICATION_VERSION}}).catch(()=>0),
  ]);
  return {
    enabled:CANDIDATE_CLASSIFICATION_AUTO_ENABLED,
    engineVersion:CANDIDATE_CLASSIFICATION_VERSION,
    scanSeconds:CANDIDATE_CLASSIFICATION_SCAN_SECONDS,
    batchSize:CANDIDATE_CLASSIFICATION_BATCH_SIZE,
    fullSweepHours:CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS,
    totalCandidates,cachedAny,cachedCurrent,
    pendingVersion:Math.max(0,totalCandidates-cachedCurrent),
    pendingQueue:candidateClassificationPending.size,
    lastScanAt:candidateClassificationLastScanAt?.toISOString?.() || null,
    lastFullSweepAt:candidateClassificationLastFullSweepAt?.toISOString?.() || null,
    ...candidateClassificationRuntime,
  };
}

function startCandidateClassificationScheduler(){
  if(candidateClassificationSchedulerStarted || !CANDIDATE_CLASSIFICATION_AUTO_ENABLED) return;
  candidateClassificationSchedulerStarted=true;
  const bootTimer=setTimeout(()=>{
    processAutomaticCandidateClassificationsOnce('AUTO_BOOT',{fullSweep:true}).catch((err)=>console.error('AUTO_BOOT classification',err));
  },CANDIDATE_CLASSIFICATION_BOOT_DELAY_MS);
  if(typeof bootTimer.unref==='function') bootTimer.unref();
  const timer=setInterval(()=>{
    processAutomaticCandidateClassificationsOnce('AUTO_INTERVAL').catch((err)=>console.error('AUTO_INTERVAL classification',err));
  },CANDIDATE_CLASSIFICATION_SCAN_SECONDS*1000);
  if(typeof timer.unref==='function') timer.unref();
  console.log(`Clasificación automática activa · motor ${CANDIDATE_CLASSIFICATION_VERSION} · revisión cada ${CANDIDATE_CLASSIFICATION_SCAN_SECONDS}s · barrido completo cada ${CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS}h · lote ${CANDIDATE_CLASSIFICATION_BATCH_SIZE}`);
}


app.get('/admin/classification/status', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req,res)=>{
  try{
    return res.json({ok:true,classificationAutomation:await candidateClassificationStatusSummary()});
  }catch(err){
    console.error('GET /admin/classification/status',err);
    return res.status(500).json({ok:false,error:'No se pudo leer el estado de clasificación automática.'});
  }
});

app.post('/admin/classification/run', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req,res)=>{
  try{
    const force=!!req.body?.force;
    const result=await processAutomaticCandidateClassificationsOnce('ADMIN_MANUAL',{manual:true,fullSweep:true,force});
    return res.json({ok:result?.ok!==false,result,classificationAutomation:await candidateClassificationStatusSummary()});
  }catch(err){
    console.error('POST /admin/classification/run',err);
    return res.status(500).json({ok:false,error:'No se pudo ejecutar la clasificación del padrón.'});
  }
});

const adminCandidateRetentionSchema = z.object({
  keepIndefinitely: z.boolean(),
});

app.post('/admin/users/:userId/send-password-recovery', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if(!userId) return res.status(400).json({ error:'Falta identificar al usuario.' });
    const target = await prisma.user.findFirst({ where:{ id:userId, role:{ in:['CANDIDATE','COMPANY'] } }, select:{ id:true, role:true, email:true } });
    if(!target) return res.status(404).json({ error:'Usuario no encontrado.' });
    const created = await createPasswordRecoveryChallenge({ user:target, role:target.role, requestedIdentifier:'ADMIN_TRIGGER' });
    return res.json({ ok:true, maskedEmail:created.maskedEmail, expiresInMinutes:PASSWORD_RESET_CODE_TTL_MINUTES });
  } catch (err) {
    console.error('POST /admin/users/:userId/send-password-recovery', err?.code || err?.message || err);
    if(err?.code === 'MAIL_NOT_CONFIGURED' || err?.message === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ error:'El correo seguro todavía no está configurado en el servidor.' });
    if(err?.code === 'RATE_LIMIT') return res.status(429).json({ error:err.message });
    return res.status(500).json({ error:'No se pudo enviar el correo de recuperación.' });
  }
});

// Endpoint antiguo deshabilitado por seguridad: Administración ya no puede fijar contraseñas.
app.post('/admin/users/:userId/reset-password', auth, requireAnyRole(['ADMIN','SUPERADMIN']), (_req, res) => res.status(410).json({ error:'Por seguridad, la contraseña sólo puede restablecerse mediante verificación por correo.' }));


const adminCommunicationSendSchema = z.object({
  audience:z.enum(['CANDIDATE','COMPANY']),
  classKey:z.string().trim().max(40).optional().default('ALL'),
  subject:z.string().trim().min(4).max(180),
  body:z.string().trim().min(10).max(10000),
  onlyNotPreviouslySent:z.boolean().optional().default(true),
});

app.get('/admin/communications/summary', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req, res) => {
  try {
    const classKeys=Object.keys(ADMIN_CANDIDATE_CLASS_LABELS);
    const [candidates, companies, history, queue, candidateTemplates, companyTemplates, ...segmentRows] = await Promise.all([
      listBulkCommunicationRecipients('CANDIDATE'),
      listBulkCommunicationRecipients('COMPANY'),
      prisma.adminCommunication.findMany({ orderBy:{ createdAt:'desc' }, take:24 }),
      communicationQueueSnapshot(),
      uniqueCommunicationTemplates('CANDIDATE'),
      uniqueCommunicationTemplates('COMPANY'),
      ...classKeys.map((classKey)=>listBulkCommunicationRecipients('CANDIDATE',{classKey})),
    ]);
    const shape = (x) => ({ totalAccounts:x.totalAccounts, reachable:x.reachable, eligible:x.recipients.length, optedOut:x.optedOut, suppressed:Number(x.suppressed||0), duplicates:x.duplicates });
    const candidateSegments=classKeys.map((key,idx)=>({ key, label:ADMIN_CANDIDATE_CLASS_LABELS[key], ...shape(segmentRows[idx]) }));
    const supportDetail=await listSupportDetailRecipients();
    candidateSegments.push({ key:SUPPORT_DETAIL_SEGMENT_KEY, label:SUPPORT_DETAIL_SEGMENT_LABEL, special:true, questionCount:Number(supportDetail.questionCount||0), coveredQuestionCount:Number(supportDetail.coveredQuestionCount||0), newQuestionCount:Number(supportDetail.newQuestionCount||0), appQuestionCount:Number(supportDetail.appQuestionCount||0), emailQuestionCount:Number(supportDetail.emailQuestionCount||0), ...shape(supportDetail) });
    return res.json({ ok:true, configured:gmailConfigured(), candidates:shape(candidates), companies:shape(companies), candidateSegments, history, templates:[...candidateTemplates,...companyTemplates], queue });
  } catch (err) {
    console.error('GET /admin/communications/summary', err?.message || err);
    return res.status(500).json({ error:'No se pudo leer el padrón de comunicaciones.' });
  }
});


app.get('/admin/communications/support-detail-template', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req, res) => {
  try{
    const guide=await buildSupportDetailGuide();
    return res.json({ok:true,...guide});
  }catch(err){
    console.error('GET /admin/communications/support-detail-template',err?.message || err);
    return res.status(500).json({error:'No se pudo preparar la guía ampliada para candidatos.'});
  }
});

// v7.10.10 · recupera exactamente la última comunicación que efectivamente tuvo envíos.
// Administración puede cargar asunto + cuerpo y volver a programarla sólo para quienes aún no la recibieron.
app.get('/admin/communications/latest-template', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  const audience=String(req.query?.audience || '').trim().toUpperCase();
  const classKey=String(req.query?.classKey || 'ALL').trim().toUpperCase();
  if(!['CANDIDATE','COMPANY'].includes(audience)) return res.status(400).json({ error:'Destinatario inválido.' });
  if(audience==='CANDIDATE' && classKey!=='ALL' && classKey!==SUPPORT_DETAIL_SEGMENT_KEY && !ADMIN_CANDIDATE_CLASS_LABELS[classKey]) return res.status(400).json({ error:'Grupo de candidatos inválido.' });
  try {
    const latest=await prisma.adminCommunication.findFirst({
      where:{ audience, sentCount:{ gt:0 } },
      orderBy:{ createdAt:'desc' },
      select:{ id:true, audience:true, subject:true, body:true, createdAt:true, completedAt:true, sentCount:true, recipientCount:true, status:true },
    });
    if(!latest) return res.status(404).json({ error: audience === 'COMPANY' ? 'Todavía no hay una comunicación enviada a empresas.' : 'Todavía no hay una comunicación enviada a candidatos.' });
    const audienceData=await listBulkCommunicationRecipients(audience,{classKey:audience==='CANDIDATE'?classKey:'ALL'});
    const pending=await filterCommunicationRecipientsByHistory({
      audience,
      subject:latest.subject,
      body:latest.body,
      recipients:audienceData.recipients,
      onlyNotPreviouslySent:true,
    });
    return res.json({
      ok:true,
      communication:latest,
      eligibleNow:audienceData.recipients.length,
      pendingRecipients:pending.recipients.length,
      alreadyReceivedOrQueued:pending.skippedPreviouslySent,
    });
  } catch (err) {
    console.error('GET /admin/communications/latest-template', err?.message || err);
    return res.status(500).json({ error:'No se pudo recuperar la última comunicación enviada.' });
  }
});

app.post('/admin/communications/send', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  if(!gmailConfigured()) return res.status(503).json({ error:'El correo institucional todavía no está configurado.' });
  const parsed = adminCommunicationSendSchema.safeParse(req.body || {});
  if(!parsed.success) return res.status(400).json({ error:'Revisá el destinatario, asunto y contenido de la comunicación.' });
  const { audience, classKey, subject, body, onlyNotPreviouslySent } = parsed.data;
  const normalizedClassKey=String(classKey || 'ALL').trim().toUpperCase();
  if(audience==='CANDIDATE' && normalizedClassKey!=='ALL' && normalizedClassKey!==SUPPORT_DETAIL_SEGMENT_KEY && !ADMIN_CANDIDATE_CLASS_LABELS[normalizedClassKey]) return res.status(400).json({ error:'Grupo de candidatos inválido.' });
  try {
    const audienceData = await listBulkCommunicationRecipients(audience,{classKey:audience==='CANDIDATE'?normalizedClassKey:'ALL'});
    const historyFilter = await filterCommunicationRecipientsByHistory({ audience, subject, body, recipients:audienceData.recipients, onlyNotPreviouslySent });
    const targetRecipients = historyFilter.recipients;
    if(!targetRecipients.length) return res.status(400).json({ error: onlyNotPreviouslySent ? 'Todos los destinatarios habilitados ya recibieron esta misma comunicación. Destildá “Sólo quienes todavía no recibieron este mensaje” si querés reenviarla a todos.' : 'No hay destinatarios habilitados para esta comunicación.' });

    // v7.9.11: el botón no dispara SMTP dentro de la petición web. Crea una campaña persistente
    // y el worker del servidor la procesa aun cuando Administración esté cerrada.
    const campaign = await prisma.adminCommunication.create({ data:{
      audience,
      subject,
      body,
      recipientCount:targetRecipients.length,
      sentCount:0,
      skippedOptOutCount:audienceData.optedOut,
      skippedPreviouslySentCount:historyFilter.skippedPreviouslySent,
      recipientMode:normalizedClassKey===SUPPORT_DETAIL_SEGMENT_KEY ? (onlyNotPreviouslySent ? 'SUPPORT_DETAIL_UNSENT_ONLY' : 'SUPPORT_DETAIL_ALL_ELIGIBLE') : (onlyNotPreviouslySent ? 'UNSENT_ONLY' : 'ALL_ELIGIBLE'),
      failedCount:0,
      status:'QUEUED',
      queuedAt:new Date(),
    }});
    await prisma.adminCommunicationRecipient.createMany({
      data:targetRecipients.map((recipient) => ({ communicationId:campaign.id, userId:recipient.userId, status:'PENDING' })),
      skipDuplicates:true,
    });
    const queue = await communicationQueueSnapshot();
    const positionRows = await prisma.adminCommunication.findMany({
      where:{ status:{ in:COMMUNICATION_NON_TERMINAL_STATUSES }, createdAt:{ lte:campaign.createdAt } },
      select:{ id:true },
      orderBy:{ createdAt:'asc' },
    });
    const queuePosition = Math.max(1, positionRows.findIndex((row) => row.id === campaign.id) + 1);
    // No esperamos al próximo intervalo si el worker está libre; igualmente el envío real respeta el pacing persistente.
    processCommunicationQueueOnce().catch(() => {});
    return res.json({
      ok:true,
      queued:true,
      communicationId:campaign.id,
      audience,
      classKey:audience==='CANDIDATE'?normalizedClassKey:'ALL',
      classLabel:audience==='CANDIDATE' && normalizedClassKey===SUPPORT_DETAIL_SEGMENT_KEY ? SUPPORT_DETAIL_SEGMENT_LABEL : (audience==='CANDIDATE' && normalizedClassKey!=='ALL' ? ADMIN_CANDIDATE_CLASS_LABELS[normalizedClassKey] : null),
      recipientCount:targetRecipients.length,
      skippedOptOutCount:audienceData.optedOut,
      skippedPreviouslySentCount:historyFilter.skippedPreviouslySent,
      recipientMode:normalizedClassKey===SUPPORT_DETAIL_SEGMENT_KEY ? (onlyNotPreviouslySent ? 'SUPPORT_DETAIL_UNSENT_ONLY' : 'SUPPORT_DETAIL_ALL_ELIGIBLE') : (onlyNotPreviouslySent ? 'UNSENT_ONLY' : 'ALL_ELIGIBLE'),
      queuePosition,
      queue,
      message:queuePosition > 1
        ? `Comunicación guardada en cola, posición ${queuePosition}. Comenzará automáticamente cuando finalice la anterior.`
        : `Comunicación guardada en cola para ${targetRecipients.length} destinatario(s).${historyFilter.skippedPreviouslySent ? ` Se excluyeron ${historyFilter.skippedPreviouslySent} porque ya tenían esta misma comunicación enviada o programada.` : ''} El envío continuará automáticamente aunque cierres Administración.`,
    });
  } catch (err) {
    console.error('POST /admin/communications/send', err?.code || err?.message || err);
    return res.status(500).json({ error:'No se pudo guardar la comunicación en la cola automática.' });
  }
});

app.post('/admin/communications/:communicationId/cancel', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  const communicationId = String(req.params.communicationId || '').trim();
  if(!communicationId) return res.status(400).json({ error:'Falta identificar la comunicación.' });
  try {
    const campaign = await prisma.adminCommunication.findUnique({ where:{ id:communicationId } });
    if(!campaign) return res.status(404).json({ error:'Comunicación no encontrada.' });
    if(!COMMUNICATION_NON_TERMINAL_STATUSES.includes(campaign.status)) return res.status(409).json({ error:'La comunicación ya finalizó y no tiene pendientes para cancelar.' });
    const now = new Date();
    await prisma.$transaction([
      prisma.adminCommunicationRecipient.updateMany({
        where:{ communicationId, status:'PENDING' },
        data:{ status:'CANCELLED', lastAttemptAt:now, lastError:'Cancelado por Administración antes del envío.' },
      }),
      prisma.adminCommunication.update({
        where:{ id:communicationId },
        data:{ status:'CANCELLED', completedAt:now, waitingUntil:null, lastError:'Pendientes cancelados por Administración.' },
      }),
    ]);
    return res.json({ ok:true, communicationId, status:'CANCELLED' });
  } catch (err) {
    console.error('POST /admin/communications/:communicationId/cancel', err?.message || err);
    return res.status(500).json({ error:'No se pudieron cancelar los envíos pendientes.' });
  }
});

app.get('/admin/communications/opt-outs', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  const audience=String(req.query?.audience || 'CANDIDATE').trim().toUpperCase();
  if(!['CANDIDATE','COMPANY'].includes(audience)) return res.status(400).json({ error:'Padrón inválido.' });
  try{
    const users=await prisma.user.findMany({
      where:{ role:audience, bulkEmailOptOutAt:{not:null} },
      select:{
        id:true,email:true,role:true,bulkEmailOptOutAt:true,bulkEmailOptOutReason:true,
        candidateProfile:{select:{fullName:true}},
        company:{select:{contactEmail:true,companyName:true}},
        communicationPreferenceEvents:{orderBy:{createdAt:'desc'},take:50},
      },
      orderBy:{bulkEmailOptOutAt:'desc'},
    });
    const items=users.map((user)=>{
      const history=(user.communicationPreferenceEvents || []).map(shapeCommunicationPreferenceEvent);
      const latest=history[0] || null;
      return {
        userId:user.id,
        role:user.role,
        name:user.role==='COMPANY' ? (user.company?.companyName || 'Empresa') : (user.candidateProfile?.fullName || 'Candidato'),
        email:normalizeEmail(user.role==='COMPANY' ? (user.company?.contactEmail || user.email) : user.email),
        optOut:true,
        optOutAt:user.bulkEmailOptOutAt,
        legacyReason:user.bulkEmailOptOutReason || null,
        currentSource:latest?.source || null,
        currentSourceLabel:latest?.historicalReconstruction && latest?.legacyReason
          ? `Registro histórico · dato disponible: ${communicationPreferenceSourceLabel(latest.legacyReason)}`
          : (latest?.sourceLabel || 'Registro histórico sin origen verificable'),
        history,
      };
    });
    return res.json({ok:true,audience,total:items.length,items});
  }catch(err){
    console.error('GET /admin/communications/opt-outs',err?.message || err);
    return res.status(500).json({error:'No se pudo leer el historial de bajas.'});
  }
});

app.get('/admin/communications/preference', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  const email = normalizeEmail(req.query?.email || '');
  if(!email) return res.status(400).json({ error:'Falta el correo a consultar.' });
  const user = await prisma.user.findFirst({
    where:{ role:{ in:['CANDIDATE','COMPANY'] }, OR:[
      { email:{ equals:email, mode:'insensitive' } },
      { company:{ is:{ contactEmail:{ equals:email, mode:'insensitive' } } } },
    ]},
    select:{
      id:true,email:true,role:true,bulkEmailOptOutAt:true,bulkEmailOptOutReason:true,
      company:{select:{contactEmail:true,companyName:true}},candidateProfile:{select:{fullName:true}},
      communicationPreferenceEvents:{orderBy:{createdAt:'desc'},take:50},
    },
  }).catch(() => null);
  if(!user) return res.json({ ok:true, found:false });
  const history=(user.communicationPreferenceEvents || []).map(shapeCommunicationPreferenceEvent);
  return res.json({
    ok:true,found:true,userId:user.id,role:user.role,
    name:user.role==='COMPANY' ? (user.company?.companyName || 'Empresa') : (user.candidateProfile?.fullName || 'Candidato'),
    email:normalizeEmail(user.company?.contactEmail || user.email),
    optOut:Boolean(user.bulkEmailOptOutAt),optOutAt:user.bulkEmailOptOutAt || null,
    optOutReason:user.bulkEmailOptOutReason || null,
    history,
  });
});

const adminCommunicationPreferenceSchema = z.object({
  email:z.string().trim().email(),
  optOut:z.boolean(),
  reason:z.string().trim().min(5).max(1000),
});

app.post('/admin/communications/preference', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  const parsed = adminCommunicationPreferenceSchema.safeParse(req.body || {});
  if(!parsed.success) return res.status(400).json({ error:'Indicá el correo, la preferencia y un motivo breve para dejar trazabilidad.' });
  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findFirst({
    where:{ role:{ in:['CANDIDATE','COMPANY'] }, OR:[
      { email:{ equals:email, mode:'insensitive' } },
      { company:{ is:{ contactEmail:{ equals:email, mode:'insensitive' } } } },
    ]},
    select:{ id:true, role:true },
  });
  if(!user) return res.status(404).json({ error:'No encontramos una cuenta candidata o empresa asociada a ese correo.' });
  try{
    const result=await changeCommunicationPreference({
      userId:user.id,
      optOut:parsed.data.optOut,
      source:'ADMIN_MAIL_REPLY',
      actorType:'ADMIN',
      actorUserId:req.user?.id || null,
      reasonCode:parsed.data.optOut ? 'ADMIN_REQUESTED_OPT_OUT' : 'ADMIN_REQUESTED_OPT_IN',
      reasonText:parsed.data.reason,
      legacyOptOutReason:'ADMIN_MAIL_REPLY',
      metadata:{ channel:'ADMIN_MAIL_PANEL' },
    });
    return res.json({ ok:true, role:user.role, optOut:result.optOut, changed:result.changed, optOutAt:result.optOutAt || null });
  }catch(err){
    console.error('POST /admin/communications/preference',err?.message || err);
    return res.status(500).json({error:'No se pudo actualizar la preferencia con trazabilidad.'});
  }
});

app.post('/communications/unsubscribe', async (req, res) => {
  try {
    const token = String(req.query?.token || req.body?.token || '');
    const decoded = verifyBulkEmailUnsubscribeToken(token);
    const user = await prisma.user.findUnique({ where:{ id:String(decoded.sub) }, select:{ id:true, role:true } });
    if(!user || !['CANDIDATE','COMPANY'].includes(user.role)) throw new Error('INVALID_UNSUBSCRIBE_USER');

    let communicationId=null, recipientId=null;
    if(decoded?.recipientId){
      const recipient=await prisma.adminCommunicationRecipient.findUnique({
        where:{id:String(decoded.recipientId)},
        select:{id:true,userId:true,communicationId:true},
      }).catch(()=>null);
      if(recipient && recipient.userId===user.id && (!decoded.communicationId || recipient.communicationId===String(decoded.communicationId))){
        communicationId=recipient.communicationId;
        recipientId=recipient.id;
      }
    }
    const contentType=String(req.headers['content-type'] || '').toLowerCase();
    const oneClickProvider=contentType.includes('application/x-www-form-urlencoded');
    const source=oneClickProvider ? 'EMAIL_PROVIDER_ONE_CLICK' : 'SELF_SERVICE_LINK';
    const actorType=oneClickProvider ? 'EMAIL_PROVIDER' : 'USER';
    const result=await changeCommunicationPreference({
      userId:user.id,
      optOut:true,
      source,
      actorType,
      reasonCode:oneClickProvider ? 'EMAIL_PROVIDER_ONE_CLICK' : 'USER_UNSUBSCRIBE_EMAIL_LINK',
      reasonText:null,
      communicationId,
      recipientId,
      legacyOptOutReason:source,
      metadata:{ unsubscribeTokenContext:Boolean(decoded?.communicationId || decoded?.recipientId) },
    });
    return res.json({
      ok:true,
      changed:result.changed,
      message:'Tu preferencia fue actualizada. No recibirás futuras comunicaciones informativas generales de Talento PyME.'
    });
  } catch (err) {
    return res.status(400).json({ error:'El enlace de baja no es válido o ya no puede utilizarse.' });
  }
});



// v8.0.9 · vista operativa limpia: sólo consultas pendientes, rebotes temporales deduplicados
// y recuperación de comunicaciones sin duplicados.
async function pendingInboundMailConsultations(){
  const rows=await prisma.inboundMailMessage.findMany({
    where:{category:'CONSULTATION'},
    orderBy:{receivedAt:'desc'},
    take:2000,
  }).catch(()=>[]);
  if(!rows.length) return [];
  const threadIds=[...new Set(rows.map((r)=>r.supportThreadId).filter(Boolean))];
  const userIds=[...new Set(rows.filter((r)=>String(r.matchedRole||'').toUpperCase()==='CANDIDATE').map((r)=>r.matchedUserId).filter(Boolean))];
  const [operatorRows,guideRows]=await Promise.all([
    threadIds.length ? prisma.supportMessage.findMany({
      where:{threadId:{in:threadIds},actor:'OPERATOR'},
      select:{threadId:true,createdAt:true},orderBy:{createdAt:'desc'},
    }).catch(()=>[]) : [],
    userIds.length ? prisma.adminCommunicationRecipient.findMany({
      where:{userId:{in:userIds},status:{in:['PENDING','SENT']},communication:{is:{recipientMode:{in:SUPPORT_DETAIL_RECIPIENT_MODES}}}},
      select:{userId:true,communication:{select:{createdAt:true}}},
    }).catch(()=>[]) : [],
  ]);
  const lastOperatorByThread=new Map();
  for(const row of operatorRows){ if(row.threadId && !lastOperatorByThread.has(row.threadId)) lastOperatorByThread.set(row.threadId,new Date(row.createdAt)); }
  const lastGuideByUser=new Map();
  for(const row of guideRows){
    const at=new Date(row.communication?.createdAt||0); const prev=lastGuideByUser.get(row.userId);
    if(!prev || at>prev) lastGuideByUser.set(row.userId,at);
  }
  return rows.filter((row)=>{
    const receivedAt=new Date(row.receivedAt || row.createdAt || 0);
    const cutoffs=[];
    if(row.supportThreadId && lastOperatorByThread.get(row.supportThreadId)) cutoffs.push(lastOperatorByThread.get(row.supportThreadId));
    if(String(row.matchedRole||'').toUpperCase()==='CANDIDATE' && row.matchedUserId && lastGuideByUser.get(row.matchedUserId)) cutoffs.push(lastGuideByUser.get(row.matchedUserId));
    const cutoff=cutoffs.sort((a,b)=>b-a)[0] || null;
    return !cutoff || receivedAt>cutoff;
  });
}

async function activeTemporaryBounceRows(){
  const rows=await prisma.inboundMailMessage.findMany({
    where:{category:'BOUNCE_TEMPORARY',bounceTargetEmail:{not:null}},
    orderBy:{receivedAt:'desc'},take:1000,
  }).catch(()=>[]);
  const grouped=new Map();
  for(const row of rows){
    const email=normalizeEmail(row.bounceTargetEmail||''); if(!email) continue;
    const prev=grouped.get(email);
    if(!prev) grouped.set(email,{latest:row,count:1}); else prev.count++;
  }
  const result=[];
  for(const [email,info] of grouped.entries()){
    const suppression=await prisma.emailSuppression.findUnique({where:{email}}).catch(()=>null);
    if(suppression?.active) continue;
    const user=await findPortalUserByEmail(email);
    let lastCommunication=null;
    let retriedAfterBounce=false;
    if(user){
      const sentRows=await prisma.adminCommunicationRecipient.findMany({
        where:{userId:user.id,status:{in:['SENT','PENDING']}},
        include:{communication:true},orderBy:{createdAt:'desc'},take:30,
      }).catch(()=>[]);
      const latestBounceAt=new Date(info.latest.receivedAt || info.latest.createdAt || 0);
      retriedAfterBounce=sentRows.some((r)=>String(r.communication?.recipientMode||'')==='BOUNCE_RETRY' && new Date(r.communication?.createdAt||0)>latestBounceAt);
      lastCommunication=sentRows.find((r)=>String(r.communication?.recipientMode||'')!=='BOUNCE_RETRY' && Number(r.communication?.sentCount||0)>0)?.communication || null;
    }
    if(retriedAfterBounce) continue;
    result.push({
      id:info.latest.id,email,receivedAt:info.latest.receivedAt || info.latest.createdAt,
      bounceCount:info.count,subject:info.latest.subject || null,matchedUserId:user?.id || null,
      lastCommunicationSubject:lastCommunication?.subject || null,lastCommunicationId:lastCommunication?.id || null,
      canRetry:Boolean(user && lastCommunication),
    });
  }
  result.sort((a,b)=>new Date(b.receivedAt||0)-new Date(a.receivedAt||0));
  return result;
}

async function uniqueCommunicationTemplates(audience){
  const rows=await prisma.adminCommunication.findMany({
    where:{audience,sentCount:{gt:0}},orderBy:{createdAt:'desc'},take:250,
    select:{id:true,audience:true,subject:true,body:true,createdAt:true,completedAt:true,sentCount:true,status:true},
  }).catch(()=>[]);
  const grouped=new Map();
  for(const row of rows){
    const key=String(row.subject||'').trim().toLowerCase().replace(/\s+/g,' ');
    if(!grouped.has(key)) grouped.set(key,{...row,lastSentAt:row.completedAt||row.createdAt,duplicateCount:1});
    else grouped.get(key).duplicateCount++;
  }
  return [...grouped.values()];
}

app.post('/admin/mail/sync', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{
    const result=await syncSupportMailboxOnce();
    const [consultations,permanentBounces,temporaryBounces,automatic,suppressed]=await Promise.all([
      prisma.inboundMailMessage.count({where:{category:'CONSULTATION'}}),
      prisma.inboundMailMessage.count({where:{category:'BOUNCE_PERMANENT'}}),
      prisma.inboundMailMessage.count({where:{category:'BOUNCE_TEMPORARY'}}),
      prisma.inboundMailMessage.count({where:{category:'AUTOMATIC'}}),
      prisma.emailSuppression.count({where:{active:true}}),
    ]);
    return res.json({ok:true,result:result||{},summary:{consultations,permanentBounces,temporaryBounces,automatic,suppressed}});
  }catch(err){
    console.error('POST /admin/mail/sync',err?.message||err);
    return res.status(500).json({error:'No se pudo sincronizar la casilla de Talento PyME.'});
  }
});

app.get('/admin/mail/unified-summary', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{
    const [pendingConsultations,permanentRows,temporaryRows,suppressed,latest]=await Promise.all([
      pendingInboundMailConsultations(),
      prisma.inboundMailMessage.findMany({where:{category:'BOUNCE_PERMANENT',bounceTargetEmail:{not:null}},select:{bounceTargetEmail:true}}).catch(()=>[]),
      activeTemporaryBounceRows(),
      prisma.emailSuppression.count({where:{active:true}}),
      prisma.inboundMailMessage.findFirst({orderBy:{processedAt:'desc'},select:{processedAt:true}}),
    ]);
    const permanentEmails=new Set(permanentRows.map((r)=>normalizeEmail(r.bounceTargetEmail||'')).filter(Boolean));
    const covered=pendingConsultations.filter((r)=>r.consultationStatus==='COVERED').length;
    const newQueries=pendingConsultations.filter((r)=>r.consultationStatus==='NEW').length;
    return res.json({ok:true,configured:gmailConfigured(),consultations:pendingConsultations.length,covered,newQueries,permanentBounces:permanentEmails.size,temporaryBounces:temporaryRows.length,suppressed,lastSyncAt:latest?.processedAt||null});
  }catch(err){ return res.status(500).json({error:'No se pudo leer el estado de la bandeja unificada.'}); }
});

app.get('/admin/mail/problems', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{
    const items=await prisma.inboundMailMessage.findMany({where:{category:{in:['BOUNCE_PERMANENT','BOUNCE_TEMPORARY']}},orderBy:{receivedAt:'desc'},take:100});
    return res.json({ok:true,items:items.map((x)=>({id:x.id,uid:x.uid,category:x.category,subject:x.subject,fromAddress:x.fromAddress,bounceTargetEmail:x.bounceTargetEmail,receivedAt:x.receivedAt,hiddenFromTraceability:x.hiddenFromTraceability}))});
  }catch(err){ return res.status(500).json({error:'No se pudieron leer los correos con problemas.'}); }
});

app.get('/admin/mail/temporary-bounces', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{ return res.json({ok:true,items:await activeTemporaryBounceRows()}); }
  catch(err){ return res.status(500).json({error:'No se pudieron leer los rebotes temporales pendientes.'}); }
});

app.post('/admin/mail/temporary-bounces/:id/retry', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req,res)=>{
  const id=String(req.params.id||'').trim();
  if(!id) return res.status(400).json({error:'Rebote temporal inválido.'});
  try{
    const bounce=await prisma.inboundMailMessage.findUnique({where:{id}});
    if(!bounce || bounce.category!=='BOUNCE_TEMPORARY') return res.status(404).json({error:'El rebote temporal ya no está disponible.'});
    const email=normalizeEmail(bounce.bounceTargetEmail||'');
    if(!email) return res.status(400).json({error:'No se pudo identificar el correo destinatario del rebote.'});
    const suppression=await prisma.emailSuppression.findUnique({where:{email}}).catch(()=>null);
    if(suppression?.active) return res.status(409).json({error:'Ese correo quedó suprimido por un rebote definitivo y no se reenviará.'});
    const user=await findPortalUserByEmail(email);
    if(!user || !['CANDIDATE','COMPANY'].includes(String(user.role||'').toUpperCase())) return res.status(404).json({error:'No se encontró una cuenta activa asociada a ese correo.'});
    const latestRecipient=await prisma.adminCommunicationRecipient.findFirst({
      where:{userId:user.id,status:'SENT',communication:{is:{recipientMode:{not:'BOUNCE_RETRY'}}}},
      include:{communication:true},orderBy:{sentAt:'desc'},
    });
    const source=latestRecipient?.communication;
    if(!source) return res.status(404).json({error:'No se encontró una comunicación general anterior para reenviar.'});
    const campaign=await prisma.adminCommunication.create({data:{
      audience:String(user.role).toUpperCase(),subject:source.subject,body:source.body,recipientCount:1,sentCount:0,
      skippedOptOutCount:0,skippedPreviouslySentCount:0,recipientMode:'BOUNCE_RETRY',failedCount:0,status:'QUEUED',queuedAt:new Date(),
    }});
    await prisma.adminCommunicationRecipient.create({data:{communicationId:campaign.id,userId:user.id,status:'PENDING'}});
    processCommunicationQueueOnce().catch(()=>{});
    return res.json({ok:true,communicationId:campaign.id,message:`Reenvío programado para ${maskEmail(email)}. Si vuelve a rebotar temporalmente aparecerá otra vez en esta lista.`});
  }catch(err){
    console.error('POST /admin/mail/temporary-bounces/:id/retry',err?.message||err);
    return res.status(500).json({error:'No se pudo programar el reenvío del correo temporal.'});
  }
});

app.get('/admin/mail/inbox', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  if(!gmailConfigured()) return res.json({ ok:true, configured:false, items:[], total:0, mailboxTotal:0, unread:0, page:1, totalPages:1, pageSize:20 });
  const page = Math.max(1, Number(req.query?.page || 1));
  const pageSize = 20;
  try {
    const pending=await pendingInboundMailConsultations();
    const total=pending.length;
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const safePage=Math.min(page,totalPages);
    const slice=pending.slice((safePage-1)*pageSize,safePage*pageSize);
    const gmailMeta=await withGmailInbox(async(client)=>{
      const mailboxTotal=Number(client.mailbox?.exists||0);
      let unread=0; try{ unread=(await client.search({seen:false},{uid:true})).length; }catch{}
      const unreadByUid=new Map();
      for(const row of slice){
        try{ const msg=await client.fetchOne(Number(row.uid),{flags:true},{uid:true}); unreadByUid.set(Number(row.uid),!(msg?.flags && msg.flags.has('\\Seen'))); }
        catch{ unreadByUid.set(Number(row.uid),false); }
      }
      return {mailboxTotal,unread,unreadByUid};
    });
    const items=slice.map((row)=>({
      id:row.id,uid:row.uid,subject:row.subject||'(sin asunto)',fromName:row.fromName||'',fromAddress:row.fromAddress||'',
      date:row.receivedAt||row.createdAt,unread:Boolean(gmailMeta.unreadByUid.get(Number(row.uid))),answered:false,
      category:row.category,consultationStatus:row.consultationStatus,bounceTargetEmail:null,
    }));
    return res.json({ok:true,configured:true,account:maskEmail(FACTORY_SUPPORT_EMAIL),mailboxTotal:gmailMeta.mailboxTotal,unread:gmailMeta.unread,page:safePage,totalPages,pageSize,total,items});
  } catch (err) {
    console.error('GET /admin/mail/inbox', err?.message || err);
    return res.status(503).json({ error:'No se pudo leer el buzón de Gmail. Verificá la configuración de correo en Render.' });
  }
});

app.get('/admin/mail/message/:uid', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  if(!gmailConfigured()) return res.status(503).json({ error:'El correo todavía no está configurado.' });
  const uid = Number(req.params.uid || 0);
  if(!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ error:'Mensaje inválido.' });
  try {
    const item = await withGmailInbox(async (client) => {
      const msg = await client.fetchOne(uid, { uid:true, envelope:true, flags:true, source:true }, { uid:true });
      if(!msg) return null;
      const parsed = await simpleParser(msg.source);
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid:true }).catch(() => null);
      return {
        uid,
        subject: parsed.subject || msg.envelope?.subject || '(sin asunto)',
        from: parsed.from?.text || '',
        fromAddress: normalizeEmail(parsed.from?.value?.[0]?.address || ''),
        to: parsed.to?.text || '',
        date: parsed.date || msg.envelope?.date || null,
        text: String(parsed.text || '').trim().slice(0, 60000) || '(El mensaje no contiene texto legible.)',
        attachments: (parsed.attachments || []).map((a) => ({ filename:a.filename || 'archivo', contentType:a.contentType || '', size:a.size || 0 })),
      };
    });
    if(!item) return res.status(404).json({ error:'Mensaje no encontrado.' });
    return res.json({ ok:true, item });
  } catch (err) {
    console.error('GET /admin/mail/message/:uid', err?.message || err);
    return res.status(503).json({ error:'No se pudo abrir el mensaje.' });
  }
});


const traceabilityReportEmailSchema = z.object({
  to: z.string().trim().email().optional(),
});

app.get('/admin/reports/traceability/pdf', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req, res) => {
  try {
    const snapshot = await buildTraceabilityReportSnapshot();
    const generatedAt = new Date(snapshot.generatedAt || Date.now());
    const pdf = await buildTraceabilityPdfBuffer(snapshot);
    const filename = buildTraceabilityReportFilename(generatedAt);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'no-store');
    return res.end(pdf);
  } catch (err) {
    console.error('GET /admin/reports/traceability/pdf', err?.message || err);
    return res.status(500).json({ error:'No se pudo generar el informe de trazabilidad.' });
  }
});

app.post('/admin/reports/traceability/email', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  if(!gmailConfigured()) return res.status(503).json({ error:'El correo institucional no está configurado para enviar reportes.' });
  const parsed = traceabilityReportEmailSchema.safeParse(req.body || {});
  if(!parsed.success) return res.status(400).json({ error:'El correo de destino no es válido.' });
  const to = normalizeEmail(parsed.data.to || TRACEABILITY_REPORT_RECIPIENT);
  if(!to) return res.status(400).json({ error:'Falta indicar el correo de destino.' });
  try {
    const snapshot = await buildTraceabilityReportSnapshot();
    const generatedAt = new Date(snapshot.generatedAt || Date.now());
    const pdf = await buildTraceabilityPdfBuffer(snapshot);
    const filename = buildTraceabilityReportFilename(generatedAt);
    const transport = await getSmtpTransport();
    await transport.sendMail({
      from:`"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
      to,
      subject:buildTraceabilityEmailSubject(generatedAt),
      text:`Adjuntamos el Informe Ejecutivo de Trazabilidad de Talento PyME generado el ${generatedAt.toLocaleString('es-AR')}.

El documento contiene únicamente información agregada y anonimizada: situación general del portal, composición de candidatos y empresas, evolución reciente, conclusiones y sugerencias de mejora.

Talento PyME · Conectando experiencia con producción.`,
      attachments:[{ filename, content:pdf, contentType:'application/pdf' }],
    });
    return res.json({ ok:true, to, filename, generatedAt:snapshot.generatedAt });
  } catch (err) {
    console.error('POST /admin/reports/traceability/email', err?.code || err?.message || err);
    if(err?.code === 'MAIL_NOT_CONFIGURED' || err?.message === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ error:'El correo institucional no está configurado.' });
    if(isMailTransportNetworkError(err)) return res.status(503).json({ error:'No se pudo conectar con Gmail para enviar el reporte.' });
    return res.status(500).json({ error:'El reporte se generó, pero no pudo enviarse por correo.' });
  }
});

app.get('/admin/candidates/:userId/detail', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if(!userId) return res.status(400).json({ error: 'Falta identificar al candidato.' });
    const candidate = await prisma.user.findFirst({
      where: { id: userId, role: 'CANDIDATE' },
      select: {
        id: true,
        email: true,
        role: true,
        candidateKeepIndefinitely: true,
        createdAt: true,
        candidateProfile: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            city: true,
            province: true,
            phone: true,
            address: true,
            headline: true,
            sector: true,
            subSector: true,
            createdAt: true,
            updatedAt: true,
            skills: { select: { id: true, name: true, level: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
          },
        },
        candidateBolsa: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            dni: true,
            nacionalidad: true,
            estadoCivil: true,
            hijos: true,
            telefono: true,
            telefonoAdicional: true,
            fechaNacimiento: true,
            correo: true,
            localidad: true,
            provinciaResidencia: true,
            paisResidencia: true,
            direccion: true,
            areaTrabajo: true,
            nivel: true,
            especialidad: true,
            especialidadOtro: true,
            rangoExperiencia: true,
            nivelEducativo: true,
            tieneCapacitacion: true,
            trabajaActualmente: true,
            sueldoPretendido: true,
            ultimoTrabajo: true,
            observaciones: true,
            voiceNarrativeRaw: true,
            voiceNarrativeSummary: true,
            voiceNarrativeAnalysisVersion: true,
            voiceNarrativeAnalysisSource: true,
            voiceNarrativeYears: true,
            voiceNarrativeProfessionalTitle: true,
            voiceNarrativeAnalyzedAt: true,
            photoDataUrl: true,
            herramientasMecanica: true,
            instrumentosElectrica: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        resume: {
          select: {
            id: true,
            summary: true,
            experience: true,
            education: true,
            certifications: true,
            observations: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        applications: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            coverNote: true,
            createdAt: true,
            job: {
              select: {
                id: true,
                title: true,
                location: true,
                modality: true,
                status: true,
                company: { select: { companyName: true } },
              },
            },
          },
        },
      },
    });
    if(!candidate) return res.status(404).json({ error: 'Candidato no encontrado.' });
    const resumeHasContent = !!candidate.resume && [
      candidate.resume.summary,
      candidate.resume.experience,
      candidate.resume.education,
      candidate.resume.certifications,
      candidate.resume.observations,
    ].some((value) => String(value || '').trim());
    const legacyCvSummary = String(candidate.candidateBolsa?.observaciones || '').trim();
    const cvContentAvailable = resumeHasContent || !!legacyCvSummary;
    const resumeForAdmin = candidate.resume
      ? { ...candidate.resume, summary: candidate.resume.summary || legacyCvSummary || null }
      : (legacyCvSummary ? {
          id: null,
          summary: legacyCvSummary,
          experience: null,
          education: null,
          certifications: null,
          observations: null,
          createdAt: candidate.candidateBolsa?.createdAt || candidate.createdAt,
          updatedAt: candidate.candidateBolsa?.updatedAt || candidate.createdAt,
        } : null);
    return res.json({
      ok: true,
      item: {
        ...candidate,
        resume: resumeForAdmin,
        adminClassification: buildCandidateAdminClassification({ ...candidate, resume: resumeForAdmin }),
        quickFacts: candidateQuickFacts(candidate),
        cvContentAvailable,
        cvContentOrigin: resumeHasContent ? 'RESUME' : (legacyCvSummary ? 'LEGACY_SUMMARY' : 'NONE'),
        keepIndefinitely: candidate.candidateKeepIndefinitely !== false,
        profileStatus: cvContentAvailable ? 'CV / resumen cargado' : (candidate.candidateBolsa ? 'Perfil laboral cargado' : (candidate.candidateProfile ? 'Registro inicial' : 'Registro pendiente')),
      },
    });
  } catch (err) {
    console.error('GET /admin/candidates/:userId/detail', err);
    return res.status(500).json({ error: 'No se pudo abrir el perfil completo del candidato.' });
  }
});

app.patch('/admin/candidates/:userId/retention', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const parsed = adminCandidateRetentionSchema.safeParse(req.body);
    if(!userId || !parsed.success) return res.status(400).json({ error: 'La selección de permanencia no es válida.' });
    const existing = await prisma.user.findFirst({ where: { id: userId, role: 'CANDIDATE' }, select: { id: true } });
    if(!existing) return res.status(404).json({ error: 'Candidato no encontrado.' });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { candidateKeepIndefinitely: parsed.data.keepIndefinitely },
      select: { id: true, candidateKeepIndefinitely: true },
    });
    return res.json({ ok: true, userId: updated.id, keepIndefinitely: updated.candidateKeepIndefinitely !== false });
  } catch (err) {
    console.error('PATCH /admin/candidates/:userId/retention', err);
    return res.status(500).json({ error: 'No se pudo guardar la permanencia del candidato.' });
  }
});

app.get('/admin/companies/:companyId/detail', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const companyId = String(req.params.companyId || '').trim();
    if(!companyId) return res.status(400).json({ error: 'Falta identificar a la empresa.' });
    const company = await prisma.companyProfile.findFirst({
      where: { id: companyId },
      select: {
        id: true,
        userId: true,
        companyName: true,
        cuit: true,
        address: true,
        contactEmail: true,
        contactName: true,
        city: true,
        province: true,
        phone: true,
        website: true,
        companySummary: true,
        adminCategory: true,
        showCompanySummary: true,
        candidateBookmarks: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true, role: true, createdAt: true } },
        jobs: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, location: true, modality: true, description: true, requirements: true, status: true, visibleToCandidates: true, createdAt: true, updatedAt: true },
        },
        billingOrders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, status: true, billingName: true, billingTaxId: true, billingTaxCondition: true,
            billingProvince: true, billingCity: true, billingAddress: true, billingAddressNumber: true,
            billingFloor: true, billingDept: true, billingPostalCode: true, billingEmail: true,
            couponCode: true, couponDiscountPct: true, subtotal: true, discountAmount: true, vatAmount: true,
            total: true, totalDays: true, totalOpenings: true, paymentProvider: true, paymentApprovedAt: true,
            paymentReceiptUrl: true, cardBrand: true, cardLast4: true, paymentNote: true, createdAt: true, updatedAt: true,
            items: { select: { id: true, planCode: true, planName: true, days: true, quantity: true, subtotal: true, openingsIncluded: true, publicationsIncluded: true, createdAt: true } },
          },
        },
        candidateAccesses: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, candidateId: true, expiresAt: true, createdAt: true },
        },
        jobPublications: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, jobId: true, expiresAt: true, createdAt: true },
        },
        supportThreads: {
          orderBy: { updatedAt: 'desc' },
          select: { id: true, subject: true, status: true, needsHuman: true, lastUserMessage: true, lastAiMessage: true, createdAt: true, updatedAt: true },
        },
      },
    });
    if(!company) return res.status(404).json({ error: 'Empresa no encontrada.' });
    return res.json({
      ok: true,
      item: {
        ...company,
        adminClassification: inferAdminCompanyCategory(company),
        profileStatus: [company.companyName, company.cuit, company.contactName, company.contactEmail, company.phone, company.city].every((value) => String(value || '').trim()) ? 'Perfil empresa completo' : 'Perfil empresa parcial',
      },
    });
  } catch (err) {
    console.error('GET /admin/companies/:companyId/detail', err);
    return res.status(500).json({ error: 'No se pudo abrir el perfil completo de la empresa.' });
  }
});


app.patch('/admin/companies/:companyId/category', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const companyId = String(req.params.companyId || '').trim();
    const parsed = adminCompanyCategorySchema.safeParse(req.body || {});
    if(!companyId || !parsed.success) return res.status(400).json({ error:'La categoría indicada no es válida.' });
    const category = parsed.data.category || null;
    const updated = await prisma.companyProfile.update({
      where: { id: companyId },
      data: { adminCategory: category },
      select: { id:true, companyName:true, companySummary:true, website:true, adminCategory:true, jobs:{ select:{ title:true, description:true, requirements:true } } },
    }).catch(() => null);
    if(!updated) return res.status(404).json({ error:'Empresa no encontrada.' });
    return res.json({ ok:true, companyId:updated.id, classification:inferAdminCompanyCategory(updated) });
  } catch (err) {
    console.error('PATCH /admin/companies/:companyId/category', err);
    return res.status(500).json({ error:'No se pudo guardar la categoría de la empresa.' });
  }
});

// v8.0.11 · Administración puede excluir perfiles de prueba de las búsquedas públicas.
app.get('/admin/search-visibility', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req,res)=>{
  try{
    const q=String(req.query.q||'').trim().slice(0,160);
    const scope=String(req.query.scope||'ALL').trim().toUpperCase();
    if(q.length<2) return res.json({ok:true,items:[]});
    const items=[];

    if(scope==='ALL' || scope==='CANDIDATE'){
      const candidates=await prisma.user.findMany({
        where:{role:'CANDIDATE',OR:[
          {email:{contains:q,mode:'insensitive'}},
          {candidateProfile:{is:{fullName:{contains:q,mode:'insensitive'}}}},
          {candidateProfile:{is:{dni:{contains:q,mode:'insensitive'}}}},
          {candidateBolsa:{is:{nombre:{contains:q,mode:'insensitive'}}}},
          {candidateBolsa:{is:{apellido:{contains:q,mode:'insensitive'}}}},
          {candidateBolsa:{is:{dni:{contains:q,mode:'insensitive'}}}},
          {candidateBolsa:{is:{correo:{contains:q,mode:'insensitive'}}}},
        ]},
        select:{
          id:true,email:true,hiddenFromSearch:true,
          candidateProfile:{select:{fullName:true,dni:true}},
          candidateBolsa:{select:{nombre:true,apellido:true,dni:true,correo:true,localidad:true}},
        },
        orderBy:{createdAt:'desc'},take:30,
      }).catch(()=>[]);
      for(const row of candidates){
        const b=row.candidateBolsa||{};
        const p=row.candidateProfile||{};
        const name=`${b.nombre||''} ${b.apellido||''}`.trim()||p.fullName||row.email||'Candidato';
        items.push({
          type:'CANDIDATE',id:row.id,label:name,
          secondary:`${b.dni||p.dni||'DNI no informado'} · ${b.correo||row.email||'sin correo'}${b.localidad?` · ${b.localidad}`:''}`,
          hiddenFromSearch:Boolean(row.hiddenFromSearch),
        });
      }
    }

    if(scope==='ALL' || scope==='COMPANY'){
      const companies=await prisma.companyProfile.findMany({
        where:{OR:[
          {companyName:{contains:q,mode:'insensitive'}},
          {cuit:{contains:q,mode:'insensitive'}},
          {contactName:{contains:q,mode:'insensitive'}},
          {contactEmail:{contains:q,mode:'insensitive'}},
          {user:{is:{email:{contains:q,mode:'insensitive'}}}},
        ]},
        select:{
          id:true,companyName:true,cuit:true,contactName:true,contactEmail:true,city:true,hiddenFromSearch:true,
          user:{select:{email:true}},
        },
        orderBy:{companyName:'asc'},take:30,
      }).catch(()=>[]);
      for(const row of companies){
        items.push({
          type:'COMPANY',id:row.id,label:row.companyName||row.user?.email||'Empresa',
          secondary:`${row.cuit||'CUIT no informado'} · ${row.contactEmail||row.user?.email||'sin correo'}${row.city?` · ${row.city}`:''}`,
          hiddenFromSearch:Boolean(row.hiddenFromSearch),
        });
      }
    }

    return res.json({ok:true,items});
  }catch(err){
    console.error('GET /admin/search-visibility',err?.message||err);
    return res.status(500).json({error:'No se pudo buscar la visibilidad de perfiles.'});
  }
});

app.patch('/admin/search-visibility/:type/:id', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req,res)=>{
  try{
    const type=String(req.params.type||'').trim().toUpperCase();
    const id=String(req.params.id||'').trim();
    const hiddenFromSearch=req.body?.hiddenFromSearch===true;
    if(!id || !['CANDIDATE','COMPANY'].includes(type)) return res.status(400).json({error:'Perfil no válido.'});

    if(type==='CANDIDATE'){
      const existing=await prisma.user.findUnique({where:{id},select:{id:true,role:true}}).catch(()=>null);
      if(!existing || existing.role!=='CANDIDATE') return res.status(404).json({error:'Candidato no encontrado.'});
      const updated=await prisma.user.update({where:{id},data:{hiddenFromSearch},select:{id:true,hiddenFromSearch:true}});
      return res.json({ok:true,type,id,hiddenFromSearch:Boolean(updated.hiddenFromSearch)});
    }

    const updated=await prisma.companyProfile.update({where:{id},data:{hiddenFromSearch},select:{id:true,hiddenFromSearch:true}}).catch(()=>null);
    if(!updated) return res.status(404).json({error:'Empresa no encontrada.'});
    return res.json({ok:true,type,id,hiddenFromSearch:Boolean(updated.hiddenFromSearch)});
  }catch(err){
    console.error('PATCH /admin/search-visibility/:type/:id',err?.message||err);
    return res.status(500).json({error:'No se pudo actualizar la visibilidad del perfil.'});
  }
});

app.get('/admin/registration-audit', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{
    const since = new Date(Date.now() - 72*60*60*1000);
    const rows = await prisma.registrationAuditEvent.findMany({ where:{ createdAt:{ gte:since } }, orderBy:{ createdAt:'desc' }, take:500 });
    const candidateRows = rows.filter(r=>r.role==='CANDIDATE' || !r.role);
    const count=(eventType,outcome)=>candidateRows.filter(r=>(!eventType || r.eventType===eventType) && (!outcome || r.outcome===outcome)).length;
    const started = count('STARTED');
    const success = count('RESULT','SUCCESS');
    const serverRejected = count('RESULT','REJECTED');
    const clientRejected = count('CLIENT_REJECTED');
    const networkErrors = count('NETWORK_ERROR');
    const reasons = new Map();
    for(const r of candidateRows){
      if(!['CLIENT_REJECTED','NETWORK_ERROR','RESULT'].includes(r.eventType)) continue;
      if(r.eventType==='RESULT' && r.outcome!=='REJECTED') continue;
      const key=String(r.reason || 'SIN_DETALLE');
      reasons.set(key,(reasons.get(key)||0)+1);
    }
    const reasonCounts=[...reasons.entries()].map(([reason,total])=>({reason,total})).sort((a,b)=>b.total-a.total).slice(0,8);
    const status = networkErrors>0 || (started>=3 && success===0 && (clientRejected+serverRejected)>0)
      ? 'ATTENTION'
      : (started===0 ? 'NO_ACTIVITY' : 'OPERATIONAL');
    return res.json({ok:true,windowHours:72,started,success,serverRejected,clientRejected,networkErrors,status,reasonCounts,lastEventAt:candidateRows[0]?.createdAt || null});
  }catch(err){
    console.error('GET /admin/registration-audit',err?.message||err);
    return res.status(500).json({error:'No se pudo leer la auditoría de registro'});
  }
});

app.post('/admin/registration-audit/check', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (_req,res)=>{
  try{
    const result = await prisma.$transaction(async(tx)=>{
      const before = await tx.user.count({ where:{role:'CANDIDATE'} });
      const probe = await tx.registrationAuditEvent.create({data:{role:'CANDIDATE',eventType:'SELF_TEST',outcome:'OK',reason:'ADMIN_CHECK',source:'ADMIN'}});
      await tx.registrationAuditEvent.delete({where:{id:probe.id}});
      const profiles = await tx.profile.count();
      return {before,profiles};
    });
    return res.json({ok:true,status:'OPERATIONAL',candidateCount:result.before,profileCount:result.profiles,checkedAt:new Date().toISOString(),message:'API y PostgreSQL permiten lectura y escritura. No se creó ningún candidato de prueba.'});
  }catch(err){
    console.error('POST /admin/registration-audit/check',err?.message||err);
    return res.status(500).json({ok:false,status:'ERROR',message:'La verificación técnica de alta no pudo completar una operación de lectura/escritura.',detail:String(err?.message||'').slice(0,180)});
  }
});

app.get('/admin/bootstrap', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    await ensureSupportKnowledgeSeed();

    const num = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : d;
    };
    const parseDaysFilter = (value) => {
      if (String(value || '').toUpperCase() === 'ALL') return null;
      const days = num(value, 30);
      return new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    };
    const parseBillingStatus = (value) => {
      const raw = String(value || 'ALL').toUpperCase();
      return ['ALL','DRAFT','PENDING_PAYMENT','PAID','FAILED','EXPIRED','CANCELLED'].includes(raw) ? raw : 'ALL';
    };
    const billingStatusLabel = (status) => ({
      DRAFT: 'Borrador',
      PENDING_PAYMENT: 'Pendiente de pago',
      PAID: 'Pagada',
      FAILED: 'Fallida',
      EXPIRED: 'Expirada',
      CANCELLED: 'Cancelada',
    }[String(status || '').toUpperCase()] || String(status || 'Documento'));
    const monthKeyOf = (value) => {
      const d = value ? new Date(value) : null;
      if (!d || Number.isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const shiftMonth = (date, delta) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
    const monthStart = (value) => {
      const d = value ? new Date(value) : new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    };
    const monthLabel = (key, format = 'short') => {
      const [year, month] = String(key || '').split('-').map((v) => Number(v));
      if (!year || !month) return '—';
      return new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: format, year: 'numeric' });
    };
    const buildMonthMap = (rows) => {
      const map = new Map();
      (rows || []).forEach((row) => {
        const key = monthKeyOf(row?.createdAt);
        if (!key) return;
        map.set(key, Number(map.get(key) || 0) + 1);
      });
      return map;
    };

    const since30 = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const candidateDays = String(req.query.candidateDays || 'ALL').toUpperCase();
    const companyDays = String(req.query.companyDays || 'ALL').toUpperCase();
    const billingDays = String(req.query.billingDays || 'ALL').toUpperCase();
    const candidateSearch = String(req.query.candidateSearch || '').trim().slice(0, 160);
    const companySearch = String(req.query.companySearch || '').trim().slice(0, 180);
    const candidateProfile = String(req.query.candidateProfile || 'ALL').trim().slice(0, 180) || 'ALL';
    const companyProfile = String(req.query.companyProfile || 'ALL').trim().slice(0, 180) || 'ALL';
    const candidatePage = Math.max(1, num(req.query.candidatePage, 1));
    const companyPage = Math.max(1, num(req.query.companyPage, 1));
    const billingPage = Math.max(1, num(req.query.billingPage, 1));
    const candidatePerPage = Math.min(100, Math.max(10, num(req.query.candidatePerPage, 50)));
    const companyPerPage = Math.min(100, Math.max(10, num(req.query.companyPerPage, 50)));
    const billingPerPage = Math.min(100, Math.max(10, num(req.query.billingPerPage, 50)));
    const billingStatus = parseBillingStatus(req.query.billingStatus || 'ALL');

    const candidateSince = parseDaysFilter(candidateDays);
    const companySince = parseDaysFilter(companyDays);
    const billingSince = parseDaysFilter(billingDays);

    const candidateDirectoryWhere = {
      role: 'CANDIDATE',
      ...(candidateSince ? { createdAt: { gte: candidateSince } } : {}),
    };
    const companyDirectoryWhere = {
      ...(companySince ? { createdAt: { gte: companySince } } : {}),
    };
    const candidateWhere = {
      ...candidateDirectoryWhere,
      ...(candidateSearch ? {
        OR: [
          { email: { contains: candidateSearch, mode: 'insensitive' } },
          { candidateProfile: { is: { fullName: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { dni: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { nombre: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { apellido: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { dni: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { correo: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { areaTrabajo: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { especialidad: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { especialidadOtro: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { ultimoTrabajo: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { voiceNarrativeProfessionalTitle: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { voiceNarrativeSummary: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { voiceNarrativeRaw: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { observaciones: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { provinciaResidencia: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { paisResidencia: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateBolsa: { is: { localidad: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { headline: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { sector: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { subSector: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { city: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { province: { contains: candidateSearch, mode: 'insensitive' } } } },
          { candidateProfile: { is: { country: { contains: candidateSearch, mode: 'insensitive' } } } },
          { resume: { is: { summary: { contains: candidateSearch, mode: 'insensitive' } } } },
          { resume: { is: { experience: { contains: candidateSearch, mode: 'insensitive' } } } },
          { resume: { is: { education: { contains: candidateSearch, mode: 'insensitive' } } } },
          { resume: { is: { certifications: { contains: candidateSearch, mode: 'insensitive' } } } },
          { resume: { is: { observations: { contains: candidateSearch, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const companyWhere = {
      ...companyDirectoryWhere,
      ...(companySearch ? {
        OR: [
          { companyName: { contains: companySearch, mode: 'insensitive' } },
          { contactName: { contains: companySearch, mode: 'insensitive' } },
          { cuit: { contains: companySearch, mode: 'insensitive' } },
          { contactEmail: { contains: companySearch, mode: 'insensitive' } },
          { phone: { contains: companySearch, mode: 'insensitive' } },
          { city: { contains: companySearch, mode: 'insensitive' } },
          { province: { contains: companySearch, mode: 'insensitive' } },
          { website: { contains: companySearch, mode: 'insensitive' } },
          { companySummary: { contains: companySearch, mode: 'insensitive' } },
          { adminCategory: { contains: companySearch, mode: 'insensitive' } },
          { jobs: { some: { OR: [
            { title: { contains: companySearch, mode: 'insensitive' } },
            { description: { contains: companySearch, mode: 'insensitive' } },
            { requirements: { contains: companySearch, mode: 'insensitive' } },
            { location: { contains: companySearch, mode: 'insensitive' } },
          ] } } },
        ],
      } : {}),
    };
    const billingWhere = {
      ...(billingSince ? { createdAt: { gte: billingSince } } : {}),
      ...(billingStatus !== 'ALL' ? { status: billingStatus } : {}),
    };

    const [candidateCount, companyCount, jobsCount, applicationCount, orderCount, paidAgg, pendingAgg, paidOrderCount, filteredCandidateCount, filteredCompanyCount, filteredBillingCount, candidateRows, companyRows, billingRows, recentThreads, candidateUpdated30, candidateApplications30, candidateChats30, companyUpdated30, companyJobs30, companyChats30, companyAccess30, candidateRecentApplications, companyRecentOrders, companyRecentOpenings, candidateRecentThreads, companyRecentThreads, recentJobs, candidateTimelineRows, companyTimelineRows, billingTimelineRows] = await Promise.all([
      prisma.user.count({ where: { role: 'CANDIDATE' } }).catch(() => 0),
      prisma.companyProfile.count().catch(() => 0),
      prisma.job.count().catch(() => 0),
      prisma.application.count().catch(() => 0),
      prisma.billingOrder.count().catch(() => 0),
      prisma.billingOrder.aggregate({ _sum: { total: true }, where: { status: 'PAID' } }).catch(() => ({ _sum: { total: 0 } })),
      prisma.billingOrder.aggregate({ _sum: { total: true }, where: { status: { in: ['PENDING_PAYMENT', 'DRAFT'] } } }).catch(() => ({ _sum: { total: 0 } })),
      prisma.billingOrder.count({ where: { status: 'PAID' } }).catch(() => 0),
      prisma.user.count({ where: candidateWhere }).catch(() => 0),
      prisma.companyProfile.count({ where: companyWhere }).catch(() => 0),
      prisma.billingOrder.count({ where: billingWhere }).catch(() => 0),
      prisma.user.findMany({
        where: candidateWhere,
        orderBy: { createdAt: 'desc' },
        skip: (candidatePage - 1) * candidatePerPage,
        take: candidatePerPage,
        select: {
          id: true,
          email: true,
          candidateKeepIndefinitely: true,
          createdAt: true,
          candidateProfile: {
            select: {
              id: true,
              fullName: true,
              dni: true,
              city: true,
              province: true,
              phone: true,
              updatedAt: true,
              createdAt: true,
            },
          },
          candidateBolsa: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              dni: true,
              areaTrabajo: true,
              especialidad: true,
              especialidadOtro: true,
              localidad: true,
              sueldoPretendido: true,
              correo: true,
              updatedAt: true,
              createdAt: true,
            },
          },
          resume: { select: { summary: true, updatedAt: true, createdAt: true } },
        },
      }).catch(() => []),
      prisma.companyProfile.findMany({
        where: companyWhere,
        orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (companyPage - 1) * companyPerPage,
        take: companyPerPage,
        include: { user: { select: { email: true, createdAt: true } } },
      }).catch(() => []),
      prisma.billingOrder.findMany({
        where: billingWhere,
        orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (billingPage - 1) * billingPerPage,
        take: billingPerPage,
        include: {
          company: { select: { companyName: true, cuit: true, contactEmail: true } },
          items: { select: { planCode: true, planName: true, days: true, quantity: true, subtotal: true, openingsIncluded: true, publicationsIncluded: true } },
        },
      }).catch(() => []),
      prisma.supportThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, include: { company: { select: { companyName: true } }, user: { select: { email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } }).catch(() => []),
      prisma.candidateBolsa.count({ where: { updatedAt: { gte: since30 } } }).catch(() => 0),
      prisma.application.count({ where: { createdAt: { gte: since30 } } }).catch(() => 0),
      prisma.supportThread.count({ where: { role: 'CANDIDATE', updatedAt: { gte: since30 } } }).catch(() => 0),
      prisma.companyProfile.count({ where: { updatedAt: { gte: since30 } } }).catch(() => 0),
      prisma.job.count({ where: { createdAt: { gte: since30 } } }).catch(() => 0),
      prisma.supportThread.count({ where: { role: 'COMPANY', updatedAt: { gte: since30 } } }).catch(() => 0),
      prisma.companyCandidateAccess.count({ where: { createdAt: { gte: since30 } } }).catch(() => 0),
      prisma.application.findMany({ orderBy: { createdAt: 'desc' }, take: 40, include: { job: { select: { title: true, company: { select: { companyName: true } } } }, user: { select: { email: true } } } }).catch(() => []),
      prisma.billingOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 40, include: { company: { select: { companyName: true } } } }).catch(() => []),
      prisma.companyCandidateAccess.findMany({ orderBy: { createdAt: 'desc' }, take: 40, include: { company: { select: { companyName: true } } } }).catch(() => []),
      prisma.supportThread.findMany({ where: { role: 'CANDIDATE' }, orderBy: { updatedAt: 'desc' }, take: 30, include: { user: { select: { email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } }).catch(() => []),
      prisma.supportThread.findMany({ where: { role: 'COMPANY' }, orderBy: { updatedAt: 'desc' }, take: 30, include: { company: { select: { companyName: true } }, user: { select: { email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } }).catch(() => []),
      prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 40, include: { company: { select: { companyName: true } } } }).catch(() => []),
      prisma.user.findMany({ where: { role: 'CANDIDATE' }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }).catch(() => []),
      prisma.companyProfile.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' } }).catch(() => []),
      prisma.billingOrder.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' } }).catch(() => []),
    ]);

    // v7.9.11 · Directorios clasificados de Administración.
    // Se consultan campos livianos de todos los registros que cumplen los filtros actuales para que
    // los contadores representen el padrón filtrado completo, no solamente la página visible.
    const [candidateClassificationRows, companyClassificationRows] = await Promise.all([
      prisma.user.findMany({
        where: candidateDirectoryWhere,
        orderBy: { createdAt:'desc' },
        select: {
          id:true, email:true, candidateKeepIndefinitely:true, createdAt:true,
          candidateProfile:{ select:{ fullName:true, dni:true, city:true, province:true, country:true, address:true, headline:true, sector:true, subSector:true, updatedAt:true } },
          candidateBolsa:{ select:{ nombre:true, apellido:true, dni:true, correo:true, localidad:true, provinciaResidencia:true, paisResidencia:true, direccion:true, nacionalidad:true, areaTrabajo:true, nivel:true, especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true, tieneCapacitacion:true, trabajaActualmente:true, ultimoTrabajo:true, observaciones:true, voiceNarrativeRaw:true, voiceNarrativeSummary:true, voiceNarrativeAnalysisVersion:true, voiceNarrativeAnalysisSource:true, voiceNarrativeYears:true, voiceNarrativeProfessionalTitle:true, voiceNarrativeStrengths:true, voiceNarrativeMotivation:true, voiceNarrativeClosing:true, voiceNarrativeAnalyzedAt:true, sueldoPretendido:true, updatedAt:true } },
          resume:{ select:{ summary:true, experience:true, education:true, certifications:true, observations:true, updatedAt:true } },
        },
      }).catch(() => []),
      prisma.companyProfile.findMany({
        where: companyDirectoryWhere,
        orderBy: [{ companyName:'asc' }],
        select: {
          id:true, userId:true, companyName:true, cuit:true, contactName:true, contactEmail:true, phone:true, city:true, province:true,
          companySummary:true, website:true, adminCategory:true, createdAt:true, updatedAt:true,
          user:{ select:{ email:true, createdAt:true } },
          jobs:{ select:{ title:true, description:true, requirements:true }, orderBy:{ createdAt:'desc' }, take:20 },
        },
      }).catch(() => []),
    ]);

    const candidateDirectoryAllItems = (candidateClassificationRows || []).map((it) => {
      const bolsa = it.candidateBolsa || {};
      const profile = it.candidateProfile || {};
      const fullNameParts = String(profile.fullName || '').trim().split(/\s+/).filter(Boolean);
      const classification = buildCandidateAdminClassification(it);
      return {
        id:it.id,
        userId:it.id,
        nombre:bolsa.nombre || fullNameParts[0] || 'Candidato',
        apellido:bolsa.apellido || fullNameParts.slice(1).join(' ') || '',
        dni:bolsa.dni || profile.dni || '',
        email:bolsa.correo || it.email || '',
        localidad:bolsa.localidad || profile.city || '',
        province:candidateResidence(it).province || profile.province || '',
        residenceProvince:candidateResidence(it).province || profile.province || '',
        residenceCountry:candidateResidenceCountry(it),
        residenceCity:candidateResidence(it).city || bolsa.localidad || profile.city || 'Ciudad no informada',
        areaTrabajo:bolsa.areaTrabajo || profile.headline || 'Perfil todavía incompleto',
        especialidad:bolsa.especialidad === 'Otros' ? (bolsa.especialidadOtro || 'Otros') : (bolsa.especialidad || ''),
        sueldoPretendido:bolsa.sueldoPretendido || 'No informada',
        keepIndefinitely:it.candidateKeepIndefinitely !== false,
        createdAt:it.createdAt,
        updatedAt:bolsa.updatedAt || profile.updatedAt || it.resume?.updatedAt || it.createdAt,
        profileStatus:String(it.resume?.summary || bolsa.observaciones || '').trim() ? 'CV / resumen cargado' : (it.candidateBolsa ? 'Perfil laboral cargado' : (it.candidateProfile ? 'Registro inicial' : 'Registro pendiente')),
        ...classification,
        _searchText:candidateProfessionalSearchText(it, classification),
      };
    });

    const candidateDirectoryFilterOptions = buildCandidateDirectoryFilterOptions(candidateDirectoryAllItems);
    const candidateDirectoryKeywordItems = candidateDirectoryAllItems.filter((item) => adminSearchTextMatch(item._searchText, candidateSearch));
    const candidateDirectoryItems = filterCandidateDirectoryItems(candidateDirectoryKeywordItems, candidateProfile).map(({ _searchText, ...item }) => item);
    const candidateProfileLabel = candidateDirectoryFilterLabel(candidateDirectoryFilterOptions, candidateProfile);

    const candidateDirectoryGroups = Object.entries(ADMIN_CANDIDATE_CLASS_LABELS).map(([classKey, classLabel]) => {
      const items = candidateDirectoryItems.filter((item) => item.classKey === classKey);
      const expertiseMap = new Map();
      for(const item of items){
        const key = String(item.expertiseKey || 'GENERAL');
        const current = expertiseMap.get(key) || { key, label:item.expertiseLabel || ADMIN_EXPERTISE_LABELS.GENERAL, count:0 };
        current.count += 1;
        expertiseMap.set(key, current);
      }
      const expertise = [...expertiseMap.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
      return { key:classKey, label:classLabel, count:items.length, expertise, items };
    }).filter((group) => group.count > 0);

    const companyDirectoryAllItems = (companyClassificationRows || []).map((it) => {
      const classification = inferAdminCompanyCategory(it);
      return {
        id:it.id, companyId:it.id, userId:it.userId,
        companyName:it.companyName || it.user?.email || 'Empresa', cuit:it.cuit || '', contactName:it.contactName || '',
        contactEmail:it.contactEmail || it.user?.email || '', phone:it.phone || '', city:it.city || '', province:it.province || '',
        createdAt:it.createdAt || it.user?.createdAt, updatedAt:it.updatedAt || it.user?.createdAt,
        adminCategory:it.adminCategory || null,
        categoryKey:classification.key, categoryLabel:classification.label, categorySource:classification.source, categoryConfidence:classification.confidence,
        activityKey:classification.activityKey || 'ACTIVIDAD_NO_ESPECIFICADA', activityLabel:classification.activityLabel || 'Actividad principal no especificada',
        _searchText:[
          it.companyName, it.cuit, it.contactName, it.contactEmail, it.phone, it.city, it.province, it.companySummary, it.website, it.adminCategory,
          classification.label, classification.activityLabel,
          ...(Array.isArray(it.jobs) ? it.jobs.flatMap((job) => [job.title, job.description, job.requirements]) : []),
        ].filter(Boolean).join(' '),
      };
    });

    const companyDirectoryFilterOptions = buildCompanyDirectoryFilterOptions(companyDirectoryAllItems);
    const companyDirectoryKeywordItems = companyDirectoryAllItems.filter((item) => adminSearchTextMatch(item._searchText, companySearch));
    const companyDirectoryItems = filterCompanyDirectoryItems(companyDirectoryKeywordItems, companyProfile).map(({ _searchText, ...item }) => item);
    const companyProfileLabel = companyDirectoryFilterLabel(companyDirectoryFilterOptions, companyProfile);

    const companyDirectoryGroups = Object.entries(ADMIN_COMPANY_CATEGORY_LABELS).map(([categoryKey, categoryLabel]) => {
      const items = companyDirectoryItems.filter((item) => item.categoryKey === categoryKey);
      const activityMap = new Map();
      for(const item of items){
        const key = String(item.activityKey || 'ACTIVIDAD_NO_ESPECIFICADA');
        const current = activityMap.get(key) || { key, label:item.activityLabel || 'Actividad principal no especificada', count:0 };
        current.count += 1;
        activityMap.set(key, current);
      }
      const activities = [...activityMap.values()].sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
      return { key:categoryKey, label:categoryLabel, count:items.length, activities, items };
    }).filter((group) => group.count > 0);

    const normalizedCandidates = (candidateRows || []).map((it) => {
      const bolsa = it.candidateBolsa || null;
      const profile = it.candidateProfile || null;
      const fullNameParts = String(profile?.fullName || '').trim().split(/\s+/).filter(Boolean);
      const updatedDates = [bolsa?.updatedAt, profile?.updatedAt, it.resume?.updatedAt, it.createdAt]
        .filter(Boolean)
        .map((value) => new Date(value))
        .filter((value) => !Number.isNaN(value.getTime()))
        .sort((a, b) => b - a);
      return {
        id: it.id,
        userId: it.id,
        bolsaId: bolsa?.id || null,
        profileId: profile?.id || null,
        nombre: bolsa?.nombre || fullNameParts[0] || 'Candidato',
        apellido: bolsa?.apellido || fullNameParts.slice(1).join(' ') || '',
        dni: bolsa?.dni || profile?.dni || '',
        areaTrabajo: bolsa?.areaTrabajo || 'Perfil todavía incompleto',
        especialidad: bolsa?.especialidad === 'Otros' ? (bolsa?.especialidadOtro || 'Otros') : (bolsa?.especialidad || ''),
        localidad: bolsa?.localidad || profile?.city || '',
        province: profile?.province || '',
        sueldoPretendido: bolsa?.sueldoPretendido || 'No informada',
        createdAt: it.createdAt,
        updatedAt: updatedDates[0] || it.createdAt,
        email: bolsa?.correo || it.email || '',
        keepIndefinitely: it.candidateKeepIndefinitely !== false,
        profileStatus: ([it.resume?.summary, bolsa?.observaciones].some((value) => String(value || '').trim()))
          ? 'CV / resumen cargado'
          : (bolsa ? 'Perfil laboral cargado' : (profile ? 'Registro inicial' : 'Registro pendiente')),
      };
    });

    const normalizedCompanies = (companyRows || []).map((it) => {
      const classification = inferAdminCompanyCategory(it);
      return {
        id: it.id,
        companyId: it.id,
        userId: it.userId,
        companyName: it.companyName || it.user?.email || 'Empresa',
        cuit: it.cuit || '',
        contactName: it.contactName || '',
        contactEmail: it.contactEmail || it.user?.email || '',
        phone: it.phone || '',
        city: it.city || '',
        province: it.province || '',
        adminCategory: it.adminCategory || null,
        categoryKey: classification.key,
        categoryLabel: classification.label,
        activityKey: classification.activityKey || 'ACTIVIDAD_NO_ESPECIFICADA',
        activityLabel: classification.activityLabel || 'Actividad principal no especificada',
        createdAt: it.createdAt || it.user?.createdAt,
        updatedAt: it.updatedAt || it.user?.createdAt,
      };
    });

    const normalizedBilling = (billingRows || []).map((it) => {
      const items = Array.isArray(it.items) ? it.items : [];
      const totalPublications = Number(it.items?.reduce((acc, item) => acc + Number(item?.publicationsIncluded || 0), 0) || 0);
      const totalOpenings = Number(it.totalOpenings || items.reduce((acc, item) => acc + Number(item?.openingsIncluded || 0), 0) || 0);
      const totalDays = Number(it.totalDays || items.reduce((acc, item) => acc + (Number(item?.days || 0) * Number(item?.quantity || 1)), 0) || 0);
      return {
        id: it.id,
        documentNo: buildInternalTicketNumber(it.id),
        companyName: it.company?.companyName || it.companyNameSnapshot || 'Empresa',
        billingName: it.billingName || it.companyNameSnapshot || it.company?.companyName || 'Sin razón social',
        billingTaxId: it.billingTaxId || it.cuitSnapshot || it.company?.cuit || '',
        billingEmail: it.billingEmail || it.contactEmailSnapshot || it.company?.contactEmail || '',
        status: it.status,
        statusLabel: billingStatusLabel(it.status),
        subtotal: Number(it.subtotal || 0),
        total: Number(it.total || 0),
        totalDays,
        totalOpenings,
        totalPublications,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
        paidAt: it.paymentApprovedAt || null,
        itemsSummary: items.map((item) => `${item.planName || item.planCode || 'Plan'} x${Number(item.quantity || 1)}`).join(', '),
      };
    });

    const uniqueEvents = (events) => {
      const seen = new Set();
      return (events || []).filter((ev) => {
        const key = [ev.type || '', ev.title || '', ev.actor || '', ev.context || '', ev.createdAt ? new Date(ev.createdAt).toISOString() : ''].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const candidateProfileEvents = normalizedCandidates.slice(0, 20).map((it) => ({
      type: 'alta_candidato',
      createdAt: it.updatedAt || it.createdAt || new Date(),
      title: `${it.apellido || ''}, ${it.nombre || ''}`.replace(/^,\s*/, '').trim() || 'Candidato',
      actor: `${it.nombre || ''} ${it.apellido || ''}`.trim() || it.email || 'Candidato',
      context: 'Registro o actualización del lado candidato',
    }));
    const candidateChatEvents = (candidateRecentThreads || []).map((it) => ({
      type: 'consulta_ia',
      createdAt: it.updatedAt || it.createdAt,
      title: it.messages?.[0]?.content || it.lastUserMessage || 'Consulta Ayuda IA',
      actor: it.user?.email || 'Candidato',
      context: 'Ayuda IA del candidato',
    }));
    const candidateApplicationEvents = (candidateRecentApplications || []).map((it) => ({
      type: 'postulacion',
      createdAt: it.createdAt,
      title: it.job?.title || 'Postulación',
      actor: it.user?.email || 'Candidato',
      context: it.job?.company?.companyName ? `Postulación a ${it.job.company.companyName}` : 'Postulación enviada',
    }));
    const companyProfileEvents = normalizedCompanies.slice(0, 20).map((it) => ({
      type: 'alta_empresa',
      createdAt: it.updatedAt || it.createdAt || new Date(),
      title: it.companyName || 'Empresa',
      actor: it.companyName || 'Empresa',
      context: 'Registro o actualización del lado empresa',
    }));
    const companyOrderEvents = (companyRecentOrders || []).map((it) => ({
      type: 'documento',
      createdAt: it.createdAt,
      title: buildInternalTicketNumber(it.id),
      actor: it.company?.companyName || 'Empresa',
      context: billingStatusLabel(it.status),
    }));
    const companyOpeningEvents = (companyRecentOpenings || []).map((it) => ({
      type: 'apertura',
      createdAt: it.createdAt,
      title: 'Ficha completa abierta',
      actor: it.company?.companyName || 'Empresa',
      context: 'Apertura de candidato desde Buscar Talento',
    }));
    const companyJobEvents = (recentJobs || []).map((it) => ({
      type: 'busqueda',
      createdAt: it.createdAt,
      title: it.title || 'Búsqueda publicada',
      actor: it.company?.companyName || 'Empresa',
      context: String(it.status || 'PUBLISHED') === 'PUBLISHED' ? 'Búsqueda publicada' : 'Búsqueda en borrador',
    }));
    const companyChatEvents = (companyRecentThreads || []).map((it) => ({
      type: 'consulta_ia',
      createdAt: it.updatedAt || it.createdAt,
      title: it.messages?.[0]?.content || it.lastUserMessage || 'Consulta Ayuda IA',
      actor: it.company?.companyName || it.user?.email || 'Empresa',
      context: 'Ayuda IA del lado empresa',
    }));

    const candidateMonthMap = buildMonthMap(candidateTimelineRows);
    const companyMonthMap = buildMonthMap(companyTimelineRows);
    const billingMonthMap = buildMonthMap(billingTimelineRows);
    const historicalDates = [
      candidateTimelineRows?.[0]?.createdAt,
      companyTimelineRows?.[0]?.createdAt,
      billingTimelineRows?.[0]?.createdAt,
    ].filter(Boolean).map((value) => new Date(value)).filter((d) => !Number.isNaN(d.getTime()));
    const currentMonth = monthStart(new Date());
    const baselineStart = shiftMonth(currentMonth, -23);
    const firstMonth = historicalDates.length ? monthStart(historicalDates.sort((a,b) => a - b)[0]) : currentMonth;
    const chartStart = firstMonth < baselineStart ? firstMonth : baselineStart;
    const monthKeys = [];
    for (let cursor = new Date(chartStart); cursor <= currentMonth; cursor = shiftMonth(cursor, 1)) {
      monthKeys.push(monthKeyOf(cursor));
    }
    const currentMonthKey = monthKeyOf(currentMonth);
    const snapshots = await ensureMonthlyAuditSnapshots({
      monthKeys,
      candidateMonthMap,
      companyMonthMap,
      billingMonthMap,
      currentMonthKey,
    });
    const monthlySeries = mergeOperationalSeriesWithSnapshots({
      monthKeys,
      liveCandidateMap: candidateMonthMap,
      liveCompanyMap: companyMonthMap,
      liveBillingMap: billingMonthMap,
      snapshots,
      currentMonthKey,
      monthLabel,
    }).map((row) => ({ ...row, shortLabel: String(row.shortLabel || '').replace('.', '') }));
    const availableYears = Array.from(new Set(monthKeys.map((key) => Number(String(key).slice(0, 4))))).sort((a, b) => a - b);
    const annualSeriesByYear = Object.fromEntries(availableYears.map((year) => [String(year), Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const snapshot = (snapshots || []).find((row) => row.monthKey === key);
      const useSnapshot = !!snapshot && key !== currentMonthKey;
      return {
        key,
        label: monthLabel(key, 'long'),
        shortLabel: new Date(year, index, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', ''),
        candidates: Number(useSnapshot ? snapshot.candidateCount : (candidateMonthMap.get(key) || 0)),
        companies: Number(useSnapshot ? snapshot.companyCount : (companyMonthMap.get(key) || 0)),
        billing: Number(useSnapshot ? snapshot.billingCount : (billingMonthMap.get(key) || 0)),
        source: useSnapshot ? 'SNAPSHOT' : 'LIVE',
      };
    })]));
    await ensureAutomaticLogicalBackup('AUTO_ADMIN').catch(() => null);
    const operationalStatus = await readDatabaseCapacityStatus();

    return res.json({
      ok: true,
      reporting: {
        title: 'Informe Ejecutivo de Trazabilidad, Evolución y Composición del Portal',
        defaultRecipient: TRACEABILITY_REPORT_RECIPIENT,
        sender: FACTORY_SUPPORT_EMAIL,
        mailConfigured: gmailConfigured(),
        privacy: 'El PDF utiliza exclusivamente información agregada y no incluye datos personales ni identificadores individuales.',
      },
      summary: {
        candidateCount,
        companyCount,
        jobsCount,
        applicationCount,
        orderCount,
        paidOrderCount,
        paidTotal: Number(paidAgg?._sum?.total || 0),
        pendingTotal: Number(pendingAgg?._sum?.total || 0),
      },
      traceability: {
        candidate: {
          totalRegistered: candidateCount,
          updatedLast30: candidateUpdated30,
          applicationsLast30: candidateApplications30,
          chatsLast30: candidateChats30,
          recentEvents: uniqueEvents([
            ...candidateProfileEvents,
            ...candidateApplicationEvents,
            ...candidateChatEvents,
          ]).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
        },
        company: {
          totalRegistered: companyCount,
          updatedLast30: companyUpdated30,
          jobsLast30: companyJobs30,
          chatsLast30: companyChats30,
          openingsLast30: companyAccess30,
          recentEvents: uniqueEvents([
            ...companyProfileEvents,
            ...companyOrderEvents,
            ...companyOpeningEvents,
            ...companyJobEvents,
            ...companyChatEvents,
          ]).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
        },
      },
      traceabilityCharts: {
        monthlyWindowSize: 4,
        currentYear: new Date().getFullYear(),
        monthlySeries,
        availableYears,
        annualSeriesByYear,
        snapshotInfo: {
          capturedMonths: Number(snapshots?.length || 0),
          lastClosedMonth: (snapshots || []).filter((row) => row.monthKey !== currentMonthKey).slice(-1)[0]?.monthKey || null,
          currentMonthKey,
        },
      },
      operationalStatus: {
        ...operationalStatus,
        snapshotInfo: {
          capturedMonths: Number(snapshots?.length || 0),
          lastClosedMonth: (snapshots || []).filter((row) => row.monthKey !== currentMonthKey).slice(-1)[0]?.monthKey || null,
          currentMonthKey,
        },
      },
      backupStatus: {
        lastBackupAt: operationalStatus.lastBackupAt || null,
        lastBackupStatus: operationalStatus.lastBackupStatus || 'PENDING',
        lastBackupKey: operationalStatus.lastBackupKey || null,
        lastBackupFileName: operationalStatus.lastBackupFileName || null,
        lastBackupSizeMb: Number(operationalStatus.lastBackupSizeMb || 0),
        lastBackupRecordCount: Number(operationalStatus.lastBackupRecordCount || 0),
        nextBackupAt: operationalStatus.nextBackupAt || null,
        recentBackups: operationalStatus.recentBackups || [],
        retainedFiles: Number(operationalStatus.retainedFiles || 0),
        localBackupEnabled: !!operationalStatus.localBackupEnabled,
        backupGuardEnabled: !!operationalStatus.backupGuardEnabled,
        backupGuardMinRatio: Number(operationalStatus.backupGuardMinRatio || 0.8),
        trustedBackupAt: operationalStatus.trustedBackupAt || null,
        trustedBackupKey: operationalStatus.trustedBackupKey || null,
        trustedBackupFileName: operationalStatus.trustedBackupFileName || null,
        lastBlockedBackupAt: operationalStatus.lastBlockedBackupAt || null,
        lastBlockedBackupKey: operationalStatus.lastBlockedBackupKey || null,
        lastBlockedBackupReason: operationalStatus.lastBlockedBackupReason || null,
        lastBlockedBackupGuardIssues: operationalStatus.lastBlockedBackupGuardIssues || [],
      },
      classificationAutomation: await candidateClassificationStatusSummary(),
      classificationComposition: buildAdminComposition(candidateDirectoryItems, companyDirectoryItems),
      candidateDirectory: {
        total:candidateDirectoryItems.length,
        groups:candidateDirectoryGroups,
        filterOptions:candidateDirectoryFilterOptions,
        selectedProfile:candidateProfile,
        selectedProfileLabel:candidateProfileLabel,
      },
      companyDirectory: {
        total:companyDirectoryItems.length,
        groups:companyDirectoryGroups,
        filterOptions:companyDirectoryFilterOptions,
        selectedProfile:companyProfile,
        selectedProfileLabel:companyProfileLabel,
      },
      candidates: normalizedCandidates,
      companies: normalizedCompanies,
      billingOrders: normalizedBilling,
      candidatePaging: {
        days: candidateDays,
        search: candidateSearch,
        profile: candidateProfile,
        profileLabel: candidateProfileLabel,
        page: candidatePage,
        perPage: candidatePerPage,
        total: filteredCandidateCount,
        totalPages: Math.max(1, Math.ceil((filteredCandidateCount || 0) / candidatePerPage)),
      },
      companyPaging: {
        days: companyDays,
        search: companySearch,
        profile: companyProfile,
        profileLabel: companyProfileLabel,
        page: companyPage,
        perPage: companyPerPage,
        total: filteredCompanyCount,
        totalPages: Math.max(1, Math.ceil((filteredCompanyCount || 0) / companyPerPage)),
      },
      billingPaging: {
        days: billingDays,
        status: billingStatus,
        page: billingPage,
        perPage: billingPerPage,
        total: filteredBillingCount,
        totalPages: Math.max(1, Math.ceil((filteredBillingCount || 0) / billingPerPage)),
      },
      threads: recentThreads,
    });
  } catch (err) {
    console.error('GET /admin/bootstrap', err);
    return res.status(500).json({ error: 'No se pudo cargar el panel general.' });
  }
});

app.get('/admin/chat/threads', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const [rows, knowledgeRows] = await Promise.all([
      prisma.supportThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 140, include: { company: { select: { companyName: true, contactEmail: true } }, user: { select: { email: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 160 } } }).catch(() => []),
      prisma.supportKnowledge.findMany({ where:{ isActive:true }, orderBy:{ updatedAt:'desc' }, take:400 }).catch(() => []),
    ]);

    // Cobertura por guía general: una vez que el candidato ya tiene una respuesta general
    // enviada o programada después de su última consulta, el hilo deja de mostrarse como pendiente.
    const candidateUserIds=[...new Set(rows.filter((t)=>String(t.role||'').toUpperCase()==='CANDIDATE' && t.userId).map((t)=>t.userId))];
    const guideRows=candidateUserIds.length ? await prisma.adminCommunicationRecipient.findMany({
      where:{
        userId:{in:candidateUserIds},
        status:{in:['PENDING','SENT']},
        communication:{is:{recipientMode:{in:SUPPORT_DETAIL_RECIPIENT_MODES}}},
      },
      select:{userId:true,communication:{select:{createdAt:true}}},
    }).catch(()=>[]) : [];
    const guideCoveredAtByUser=new Map();
    for(const row of guideRows){
      const at=new Date(row.communication?.createdAt||0);
      const prev=guideCoveredAtByUser.get(row.userId);
      if(!prev || at>prev) guideCoveredAtByUser.set(row.userId,at);
    }

    // Los EMAIL válidos son solamente los que la bandeja unificada clasificó como CONSULTATION.
    // Rebotes y automáticos nunca deben reaparecer en Chat operador aunque exista un mensaje histórico.
    const threadIds=rows.map((t)=>t.id);
    const inboundConsultations=threadIds.length ? await prisma.inboundMailMessage.findMany({
      where:{supportThreadId:{in:threadIds},category:'CONSULTATION'},
      select:{supportThreadId:true,uid:true},
    }).catch(()=>[]) : [];
    const validInboundRefs=new Set(inboundConsultations.map((r)=>`${r.supportThreadId}:gmail:${MAILBOX_FOLDER}:${Number(r.uid)}`));

    let coveredCount=0;
    let newCount=0;
    const items=[];
    for(const thread of rows){
      const recipientEmail = resolveSupportThreadRecipient(thread);
      const validMessages=(thread.messages || []).filter((m)=>{
        if(m.actor!=='USER') return true;
        if(String(m.source||'APP').toUpperCase()!=='EMAIL') return true;
        if(!m.externalRef) return false;
        return validInboundRefs.has(`${thread.id}:${m.externalRef}`);
      });
      const userMessages=validMessages.filter((m)=>m.actor==='USER');
      if(!userMessages.length) continue;
      const lastUser=userMessages[userMessages.length-1];
      const lastOperator=[...validMessages].reverse().find((m)=>m.actor==='OPERATOR') || null;
      const operatorAt=lastOperator ? new Date(lastOperator.createdAt) : null;
      const guideAt=String(thread.role||'').toUpperCase()==='CANDIDATE' && thread.userId ? guideCoveredAtByUser.get(thread.userId) : null;
      const resolvedCutoff=[operatorAt,guideAt].filter(Boolean).sort((a,b)=>b-a)[0] || null;
      const pendingUserMessages=userMessages.filter((m)=>!resolvedCutoff || new Date(m.createdAt)>resolvedCutoff);
      if(!pendingUserMessages.length) continue;

      let threadCoveredCount=0;
      let threadNewCount=0;
      const messages=validMessages.map((m)=>{
        if(m.actor!=='USER') return m;
        const consultationClassification=classifySupportConsultationStatus(m.content,thread.role,knowledgeRows);
        if(pendingUserMessages.some((p)=>p.id===m.id)){
          if(consultationClassification.key==='COVERED'){ coveredCount++; threadCoveredCount++; }
          else { newCount++; threadNewCount++; }
        }
        return { ...m, consultationClassification };
      });
      const lastUserMessage=[...messages].reverse().find((m)=>m.actor==='USER') || null;
      items.push({
        ...thread,
        messages,
        pendingMessageCount:pendingUserMessages.length,
        consultationCounters:{ covered:threadCoveredCount, new:threadNewCount, total:threadCoveredCount+threadNewCount },
        lastConsultationClassification:lastUserMessage?.consultationClassification || null,
        recipientEmail: recipientEmail || null,
        maskedRecipientEmail: recipientEmail ? maskEmail(recipientEmail) : null,
        canEmail: Boolean(recipientEmail && gmailConfigured()),
        lastOperatorMessage: lastOperator?.content || null,
        lastOperatorAt: lastOperator?.createdAt || null,
      });
    }
    return res.json({ ok: true, items, consultationCounters:{ covered:coveredCount, new:newCount, total:coveredCount+newCount }, mailConfigured:gmailConfigured(), pendingOnly:true });
  } catch (err) {
    console.error('GET /admin/chat/threads', err);
    return res.status(500).json({ error: 'No se pudo cargar el chat operador.' });
  }
});

app.post('/admin/chat/reply', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const threadId = String(req.body?.threadId || '').trim();
    const content = clampMultilineText(req.body?.content || '', 4000);
    const reusable = !!req.body?.reusable;
    const emailAlso = !!req.body?.emailAlso;
    if(!threadId || !content) return res.status(400).json({ error: 'Faltan datos para responder.' });
    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: { company: { select: { companyName:true, contactEmail:true } }, user: { select: { email:true } }, messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
    });
    if(!thread) return res.status(404).json({ error: 'Conversación no encontrada.' });
    await prisma.supportMessage.create({ data: { threadId, actor: 'OPERATOR', content, reusable, source:'OPERATOR' } });
    await prisma.supportThread.update({ where: { id: threadId }, data: { needsHuman: false, status: 'WAITING_USER', lastAiMessage: content } }).catch(() => null);
    if(reusable){
      const userPrompt = thread.messages.find((m)=> m.actor === 'USER')?.content || thread.lastUserMessage || content;
      const keywords = Array.from(new Set(normalizeName(userPrompt).split(' ').filter((tok)=> tok.length >= 4))).slice(0,12);
      await prisma.supportKnowledge.create({ data: { scope: thread.role, keywords, questionSample: userPrompt.slice(0,180), answer: content, source: 'operator', isActive: true } }).catch(() => null);
    }

    let emailResult = { requested:emailAlso, ok:false, maskedEmail:null, error:null };
    if(emailAlso){
      try {
        const sent = await sendSupportOperatorEmail({ thread, content });
        emailResult = { requested:true, ok:true, maskedEmail:sent.maskedEmail, error:null };
        await recordSecurityEvent({
          route:'/admin/chat/reply', actorUserId:req.user?.id || null, severity:'INFO', eventType:'SUPPORT_EMAIL_SENT',
          message:'Respuesta del operador enviada también por correo.',
          metadata:{ threadId, role:thread.role, recipient:sent.maskedEmail, resend:false }
        }).catch(() => null);
      } catch(mailErr) {
        emailResult = { requested:true, ok:false, maskedEmail:maskEmail(resolveSupportThreadRecipient(thread)), error:mailErr?.code || mailErr?.message || 'MAIL_SEND_FAILED' };
        console.error('POST /admin/chat/reply email', mailErr?.code || mailErr?.message || mailErr);
      }
    }
    return res.json({ ok: true, email:emailResult });
  } catch (err) {
    console.error('POST /admin/chat/reply', err);
    return res.status(500).json({ error: 'No se pudo enviar la respuesta del operador.' });
  }
});

app.post('/admin/chat/resend-last-email', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const threadId = String(req.body?.threadId || '').trim();
    if(!threadId) return res.status(400).json({ error:'Seleccioná una conversación.' });
    const thread = await prisma.supportThread.findUnique({
      where:{ id:threadId },
      include:{ company:{ select:{ companyName:true, contactEmail:true } }, user:{ select:{ email:true } }, messages:{ orderBy:{ createdAt:'desc' }, take:100 } }
    });
    if(!thread) return res.status(404).json({ error:'Conversación no encontrada.' });
    const lastOperator = (thread.messages || []).find((m) => m.actor === 'OPERATOR');
    if(!lastOperator?.content) return res.status(400).json({ error:'Todavía no hay un mensaje del administrador para reenviar.' });
    const sent = await sendSupportOperatorEmail({ thread, content:lastOperator.content });
    await recordSecurityEvent({
      route:'/admin/chat/resend-last-email', actorUserId:req.user?.id || null, severity:'INFO', eventType:'SUPPORT_EMAIL_RESENT',
      message:'Se reenvió por correo el último mensaje informado por el operador.',
      metadata:{ threadId, role:thread.role, recipient:sent.maskedEmail, resend:true, sourceMessageId:lastOperator.id }
    }).catch(() => null);
    return res.json({ ok:true, maskedEmail:sent.maskedEmail, sentAt:new Date().toISOString() });
  } catch(err) {
    console.error('POST /admin/chat/resend-last-email', err?.code || err?.message || err);
    if(err?.code === 'MAIL_NOT_CONFIGURED' || err?.message === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ error:'El correo institucional no está configurado.' });
    if(err?.code === 'RECIPIENT_NOT_AVAILABLE') return res.status(400).json({ error:'Esta conversación no tiene un correo destinatario disponible.' });
    if(isMailTransportNetworkError(err)) return res.status(503).json({ error:'No se pudo conectar con Gmail para reenviar el mensaje.' });
    return res.status(500).json({ error:'No se pudo reenviar el último mensaje por correo.' });
  }
});

app.get('/admin/knowledge', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const items = await prisma.supportKnowledge.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 }).catch(() => []);
    return res.json({ ok: true, items });
  } catch (err) {
    console.error('GET /admin/knowledge', err);
    return res.status(500).json({ error: 'No se pudo cargar la base de respuestas.' });
  }
});

app.post('/admin/upgrade/access', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const password = String(req.body?.password || '').trim();
    if(!password) return res.status(400).json({ error: 'Ingresá tu clave personal para continuar.' });

    let passwordOk = false;
    if (req.user?.id === VIRTUAL_ADMIN_USER_ID) {
      passwordOk = password === FACTORY_ADMIN_PASSWORD;
    } else {
      const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } }).catch(() => null);
      if (!currentUser?.passHash) return res.status(404).json({ error: 'No se pudo validar el usuario actual.' });
      passwordOk = await bcrypt.compare(password, currentUser.passHash);
    }
    if(!passwordOk) return res.status(401).json({ error: 'La clave ingresada no coincide con la sesión actual.' });

    const ops = await readDatabaseCapacityStatus().catch(() => ({}));
    const url = ops?.upgradeUrl || ops?.infraUrl || ops?.backupUrl || guessProviderConsoleUrl(String(ops?.dbName || 'principal')) || null;
    if(!url) return res.status(400).json({ error: 'Todavía no hay una URL de ampliación/configuración definida para la base.' });

    return res.json({
      ok: true,
      url,
      providerNote: ops?.providerLoginNote || 'El proveedor puede pedir un segundo acceso propio de infraestructura.',
      dbName: ops?.dbName || 'principal',
    });
  } catch (err) {
    console.error('POST /admin/upgrade/access', err);
    return res.status(500).json({ error: 'No se pudo validar el acceso a la ampliación de capacidad.' });
  }
});

app.get('/admin/backup/status', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const summary = await readBackupOperationalSummary();
    return res.json({ ok: true, ...summary });
  } catch (err) {
    console.error('GET /admin/backup/status', err);
    return res.status(500).json({ error: 'No se pudo leer el estado del backup.' });
  }
});

app.post('/admin/backup/run', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const result = await runLogicalBackup('MANUAL_ADMIN');
    if (result?.blocked) {
      return res.status(409).json({
        error: result?.guard?.issues?.[0] || 'El backup fue bloqueado por resguardo preventivo.',
        blocked: true,
        result,
      });
    }
    if (!result?.ok) return res.status(500).json({ error: result?.error || 'No se pudo generar el backup.' });
    const summary = await readBackupOperationalSummary();
    return res.json({ ok: true, result, summary });
  } catch (err) {
    console.error('POST /admin/backup/run', err);
    return res.status(500).json({ error: 'No se pudo ejecutar el backup.' });
  }
});

app.get('/admin/backup/download/latest', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const latest = await getLatestCompletedBackupLog();
    if (!latest?.filePath || !latest?.fileName) return res.status(404).json({ error: 'No hay backup disponible para descargar.' });
    return res.download(latest.filePath, latest.fileName);
  } catch (err) {
    console.error('GET /admin/backup/download/latest', err);
    return res.status(500).json({ error: 'No se pudo descargar el backup.' });
  }
});

app.get('/admin/backup/verify/latest', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const latest = await getLatestCompletedBackupLog();
    if (!latest?.filePath || !latest?.fileName) return res.status(404).json({ error: 'No hay backup disponible para verificar.' });
    const expectedChecksum = latest?.metadata?.checksumSha256 || null;
    const report = await inspectBackupFile(latest.filePath, expectedChecksum);
    return res.json({
      ok: true,
      verification: {
        fileName: latest.fileName,
        backupKey: latest.backupKey,
        verifiedAt: new Date().toISOString(),
        checksumSha256: report.checksumSha256,
        checksumMatches: report.checksumMatches,
        fileSizeMb: report.fileSizeMb,
        datasetCount: report.verification.datasetCount,
        recordCount: report.verification.recordCount,
        integrityOk: report.verification.ok,
        errors: report.verification.errors,
        createdAt: report.verification.createdAt,
        appVersion: report.verification.appVersion,
      },
    });
  } catch (err) {
    console.error('GET /admin/backup/verify/latest', err);
    return res.status(500).json({ error: 'No se pudo verificar el último backup.' });
  }
});

app.get('/admin/backup/restore/preview/latest', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const latest = await getLatestCompletedBackupLog();
    if (!latest?.filePath || !latest?.fileName) return res.status(404).json({ error: 'No hay backup disponible para simular restauración.' });
    const report = await inspectBackupFile(latest.filePath, latest?.metadata?.checksumSha256 || null);
    const stats = report.payload?.stats || {};
    return res.json({
      ok: true,
      preview: {
        fileName: latest.fileName,
        backupKey: latest.backupKey,
        createdAt: report.payload?.meta?.createdAt || null,
        appVersion: report.payload?.meta?.appVersion || null,
        checksumSha256: report.checksumSha256,
        integrityOk: report.verification.ok,
        datasets: report.verification.datasetNames,
        datasetCount: report.verification.datasetCount,
        recordCount: report.verification.recordCount,
        stats,
        note: 'Simulación de restauración: permite confirmar que el archivo es legible y contiene la estructura necesaria antes de usarlo como resguardo administrativo.',
      },
    });
  } catch (err) {
    console.error('GET /admin/backup/restore/preview/latest', err);
    return res.status(500).json({ error: 'No se pudo simular la restauración del último backup.' });
  }
});

const PORT = process.env.PORT || 10000;
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (IS_MAIN) {
  startAutomaticBackupScheduler();
  startCommunicationQueueScheduler();
  startSupportMailboxScheduler();
  startCandidateClassificationScheduler();
  app.listen(PORT, "0.0.0.0", () => console.log("Talento PyME API escuchando en", PORT, "(v"+APP_VERSION+")"));
}

export { app, prisma };
