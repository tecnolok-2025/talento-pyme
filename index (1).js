import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createPaymentProvider, getPaymentConfigFromEnv } from "./services/payments/index.js";
import { assertNoCardData, listForbiddenPaymentFields, sanitizeCheckoutPayloadForLog, sha256Hex, PaymentProviderError, PaymentSecurityError } from "./services/payments/provider.js";

const prisma = new PrismaClient();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const PUBLIC_UPLOADS = "/uploads";

app.use(cors());
app.use((req, res, next) => {
  if (req.path.startsWith("/payments/webhook/")) return next();
  return express.json({ limit: "3mb" })(req, res, next);
});
app.use(PUBLIC_UPLOADS, express.static(UPLOADS_DIR, { maxAge: "7d" }));

// Version única (proviene de package.json cuando se ejecuta vía `npm start`)
const APP_VERSION = process.env.npm_package_version || "dev";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const FACTORY_SUPERADMIN_KEY = String(process.env.FACTORY_SUPERADMIN_KEY || '').trim();
const FACTORY_ADMIN_ALIAS = String(process.env.FACTORY_ADMIN_ALIAS || '').trim();
const FACTORY_ADMIN_PASSWORD = String(process.env.FACTORY_ADMIN_PASSWORD || '').trim();
const FACTORY_SUPPORT_EMAIL = String(process.env.FACTORY_SUPPORT_EMAIL || 'factory@gmail.com').trim();
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
  password: z.string().min(8).max(200),
  dni: z.string().max(20).optional(),
  companyName: z.string().max(160).optional(),
  cuit: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  phone: z.string().max(60).optional(),
  contactName: z.string().max(120).optional(),
  contactEmail: z.string().email().max(180).optional()
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
      const contactNameNorm = normalizeName(contactName || fullName || "");

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passHash,
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
      const contactNameNorm = normalizeName(contactName || fullName || "");

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

  const normalizedIdentifier = normalizeName(identifier);
  if (FACTORY_ADMIN_ALIAS && FACTORY_ADMIN_PASSWORD && normalizedIdentifier === normalizeName(FACTORY_ADMIN_ALIAS)) {
    const okAdmin = password === FACTORY_ADMIN_PASSWORD;
    if (!okAdmin) return res.status(401).json({ error: 'Clave incorrecta' });
    return res.json({ token: signToken({ id: VIRTUAL_ADMIN_USER_ID, role: VIRTUAL_ADMIN_ROLE }), role: VIRTUAL_ADMIN_ROLE, admin: true });
  }

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
    return res.status(401).json({ error: "Nombre no coincide lo suficiente." });
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
  observaciones: z.string().max(12000).optional().nullable(),

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

  return lines.join("\n\n");
}

function analyzeResumeText(text, sections){
  const entries = extractExperienceEntries(text, sections);
  const companyData = detectCompaniesAndSites(entries, sections);
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
    try{ raw = buf.toString("utf-8"); } catch { raw = ""; }
  }
  return cleanTextForAnalysis(collapseSpacedLetters(raw));
}

app.post("/resume/parse", auth, upload.single("file"), async (req, res) => {
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
  website: z.string().max(200).optional().nullable(),
  companySummary: z.string().max(2400).optional().nullable(),
  showCompanySummary: z.boolean().optional().nullable(),
  candidateBookmarks: z.array(z.string()).optional().nullable()
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
    if(data.observaciones) data.observaciones = clampText(data.observaciones, 12000);

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

app.post("/bolsa/photo", authRequired, upload.single("photo"), async (req, res) => {
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

app.delete("/bolsa/photo", authRequired, async (req, res) => {
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
    const localidad = String(it.localidad || '').trim();
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
      select: {
        areaTrabajo: true,
        localidad: true,
        nivel: true,
        rangoExperiencia: true,
        nivelEducativo: true,
        especialidad: true,
        especialidadOtro: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });
    const total = await prisma.candidateBolsa.count();
    return res.json({ ok: true, total, ...facetStats(items) });
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
      select: {
        id:true, nombre:true, apellido:true, dni:true, nacionalidad:true, estadoCivil:true, hijos:true,
        telefono:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true,
        user: { select: { resume: { select: { summary: true, experience: true, education: true, observations: true } } } }
      },
      take: 2000,
    });

    const sinceDate = _registeredSinceDate(ultimaActualizacion);
    const filtered = all.filter((it) => {
      const esp = it.especialidad === 'Otros' ? (it.especialidadOtro || 'Otros') : (it.especialidad || '');
      if (q) {
        const summary = `${it.user?.resume?.summary || ''} ${it.user?.resume?.experience || ''} ${it.user?.resume?.education || ''} ${it.user?.resume?.observations || ''}`;
        const hay = normalizeName(`${it.nombre || ''} ${it.apellido || ''} ${it.dni || ''} ${it.localidad || ''} ${it.areaTrabajo || ''} ${it.especialidad || ''} ${it.especialidadOtro || ''} ${it.observaciones || ''} ${it.ultimoTrabajo || ''} ${summary} ${(toArrayField(it.herramientasMecanica) || []).join(' ')} ${(toArrayField(it.instrumentosElectrica) || []).join(' ')}`);
        const qTokens = normalizeName(q).split(' ').filter(Boolean);
        if (!qTokens.every((tok) => hay.includes(tok))) return false;
      }
      if (area && String(it.areaTrabajo || '') !== area) return false;
      if (localidad && !localityMatches(it.localidad, localidad)) return false;
      if (nivel && String(it.nivel || '') !== nivel) return false;
      if (especialidad && String(esp || '') !== especialidad) return false;
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
      nombre: it.nombre,
      apellido: it.apellido,
      localidad: it.localidad,
      area_trabajo: it.areaTrabajo,
      nivel: it.nivel,
      especialidad: it.especialidad,
      especialidad_otro: it.especialidadOtro,
      soldador_categoria: it.soldadorCategoria || null,
      rango_experiencia: it.rangoExperiencia,
      nivel_educativo: it.nivelEducativo,
      tiene_capacitacion: it.tieneCapacitacion,
      trabaja_actualmente: it.trabajaActualmente,
      sueldo_pretendido: it.sueldoPretendido,
      ultimo_trabajo: it.ultimoTrabajo,
      observaciones: it.observaciones || it.user?.resume?.summary || '',
      resume_summary: it.user?.resume?.summary || '',
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
    const accessResult = await ensureCompanyCandidateAccess(company.id, candidateId);
    if(!accessResult.ok){
      return res.status(402).json({ error: accessResult.error, openingUsage: accessResult.usage || null });
    }
    const it = await prisma.candidateBolsa.findUnique({
      where: { id: candidateId },
      select: {
        id:true, nombre:true, apellido:true, dni:true, nacionalidad:true, estadoCivil:true, hijos:true,
        telefono:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true
      }
    });
    if(!it) return res.status(404).json({ error: 'Candidato no encontrado' });
    return res.json({
      ok: true,
      consumed: accessResult.consumed,
      openingUsage: accessResult.usage,
      item: {
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
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'TalentoPyME/5.7.1 (+Render)' } });
    const html = await response.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1].replace(/\s+/g,' ').trim();
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) || [,''])[1].trim();
    const ogDesc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i) || [,''])[1].trim();
    const bodyText = stripHtml(html).slice(0, 2400);
    const data = summarizeCompanySite({ title, description: metaDesc || ogDesc, bodyText, url });
    res.json({ ok: true, ...data });
  } catch (err) {
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
        telefono:true, correo:true, localidad:true, direccion:true, areaTrabajo:true, nivel:true,
        especialidad:true, especialidadOtro:true, rangoExperiencia:true, nivelEducativo:true,
        tieneCapacitacion:true, trabajaActualmente:true, sueldoPretendido:true, ultimoTrabajo:true,
        observaciones:true, photoDataUrl:true, herramientasMecanica:true, instrumentosElectrica:true, createdAt:true, updatedAt:true
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

  const where = { status: "PUBLISHED", visibleToCandidates: true };
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
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if(!job || job.company?.userId !== req.user.id) return res.status(404).json({ error: "Búsqueda no encontrada" });
    await prisma.job.delete({ where: { id: job.id } });
    res.json({ ok:true, deleted:true });
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





const SUPPORT_KNOWLEDGE_SEEDS = [
  { scope: 'GLOBAL', keywords: ['registro perfil completar datos formulario candidato cv observaciones resumen curricular foto'], questionSample: '¿Qué tengo que completar en mi perfil?', answer: 'Después del registro inicial conviene completar los datos personales, el perfil laboral, la experiencia, la pretensión económica, el resumen curricular en observaciones y, si querés, adjuntar una foto y tu CV para mejorar la visibilidad en búsquedas.' },
  { scope: 'CANDIDATE', keywords: ['mi perfil candidato foto cv observaciones resumen curricular guardar editar'], questionSample: '¿Cómo completo Mi Perfil?', answer: 'En Mi Perfil podés editar tus datos laborales, cargar una foto, adjuntar el CV para extraer un resumen curricular y revisar el punto de observaciones antes de guardar. Lo importante es dejar completo el perfil para aparecer mejor en las búsquedas de empresas.' },
  { scope: 'CANDIDATE', keywords: ['mis oportunidades postularme postulaciones eliminar postulación'], questionSample: '¿Cómo me postulo?', answer: 'Desde Mis Oportunidades buscás avisos y, cuando un puesto te interesa, lo pasás a Mis Postulaciones. Ahí queda registrada tu postulación y podés revisarla o eliminarla si ya no querés seguir en ese proceso.' },
  { scope: 'COMPANY', keywords: ['buscar talento filtros texto libre resumen curricular observaciones herramientas instrumentacion'], questionSample: '¿Cómo funciona Buscar Talento?', answer: 'Buscar Talento permite filtrar por área, especialidad, experiencia, educación, herramientas, instrumentación y texto libre. El texto libre también revisa el resumen curricular, observaciones, último trabajo y otros datos clave del perfil para ampliar coincidencias útiles.' },
  { scope: 'COMPANY', keywords: ['mis candidatos guardados postulaciones recibidas pretension economica sueldo'], questionSample: '¿Qué veo en Mis Candidatos?', answer: 'En Mis Candidatos se listan los perfiles guardados o recibidos desde postulaciones. Vas a ver datos resumidos del perfil, la pretensión económica en formato contable y, al abrir una ficha completa, se consume capacidad si corresponde según el plan vigente.' },
  { scope: 'COMPANY', keywords: ['mis busquedas publicar busqueda publicaciones cupo plan'], questionSample: '¿Cómo se consume la capacidad de publicaciones?', answer: 'Cada vez que publicás una búsqueda se descuenta capacidad del plan activo de la empresa. El sistema muestra el saldo operativo para que puedas controlar cuántas publicaciones y búsquedas te quedan disponibles.' },
  { scope: 'COMPANY', keywords: ['factory planes publicaciones busquedas compra bonificacion iva carrito checkout'], questionSample: '¿Cómo funcionan los planes de Factory?', answer: 'Factory permite contratar capacidad por tiempo. Cada plan habilita días, publicaciones y búsquedas. El precio publicado es sin IVA, el impuesto se suma al confirmar la compra y los códigos de bonificación válidos se aplican una sola vez. El pago se completa en un proveedor externo seguro y la orden solo queda pagada cuando el proveedor la confirma.' },
  { scope: 'COMPANY', keywords: ['abrir ficha candidato aperturas creditos saldo capacidad operativa'], questionSample: '¿Cómo se consumen los créditos?', answer: 'La empresa puede ver resultados resumidos sin consumir crédito. La apertura completa de una ficha consume capacidad según el plan activo o el acceso especial vigente. El panel comercial muestra el saldo disponible para operar.' },
  { scope: 'COMPANY', keywords: ['factory admin matriz planes precio dias publicaciones busquedas bonificaciones acceso free'], questionSample: '¿Para qué sirve Factory Admin?', answer: 'Factory Admin permite editar la matriz comercial de días, publicaciones, búsquedas y precio, generar códigos de bonificación, crear accesos especiales free y revisar la operatoria comercial desde la empresa habilitada para administración.' },
  { scope: 'SUPERADMIN', keywords: ['panel general empresas candidatos estadisticas chat operador conocimiento'], questionSample: '¿Qué muestra el Panel General?', answer: 'El Panel General reúne estadísticas globales del sistema, listados de empresas y candidatos, actividad comercial y el centro de conversaciones para operador. Desde ahí también se administra el conocimiento reutilizable del chat de ayuda.' }
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
  if(!candidate) return { done: 0, total: 5, percent: 0, pending: ['datos personales','perfil laboral','pretensión económica','resumen curricular','foto'] };
  const blocks = [
    { label: 'datos personales', complete: [candidate.dni, candidate.telefono, candidate.correo, candidate.localidad].every((v)=> String(v || '').trim()) },
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
    return 'Puedo ayudarte con Mi Perfil, carga de foto, resumen curricular, CV, Mis Oportunidades y Mis Postulaciones. También puedo indicarte cómo revisar la barra de completitud para mejorar tu visibilidad.';
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
    build: async () => 'En Mi Perfil tenés dos acciones principales: foto y CV. La foto se puede tomar con la cámara o subir desde el dispositivo en JPG, JPEG, PNG, WEBP o HEIC. El CV se usa para extraer un resumen curricular; el sistema no necesita conservar el archivo original de forma permanente. Conviene revisar después el campo Observaciones para completar o corregir el alcance curricular que verá la empresa.'
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
    .filter((item)=> item.score > 0)
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
    return res.json({ ok: true, thread: refreshed.thread || thread, messages: refreshed.messages || [], suggested });
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

app.get('/admin/bootstrap', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    await ensureSupportKnowledgeSeed();
    const since30 = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const [candidateCount, companyCount, jobsCount, applicationCount, orderCount, paidTotal, candidates, companies, recentThreads, candidateUpdated30, candidateApplications30, candidateChats30, companyUpdated30, companyJobs30, companyChats30, companyAccess30, candidateRecentApplications, companyRecentOrders, companyRecentOpenings, candidateRecentThreads, companyRecentThreads, recentJobs] = await Promise.all([
      prisma.candidateBolsa.count(),
      prisma.companyProfile.count(),
      prisma.job.count(),
      prisma.application.count(),
      prisma.billingOrder.count(),
      prisma.billingOrder.aggregate({ _sum: { total: true }, where: { status: 'PAID' } }).catch(() => ({ _sum: { total: 0 } })),
      prisma.candidateBolsa.findMany({ orderBy: { updatedAt: 'desc' }, take: 80, select: { id:true, nombre:true, apellido:true, areaTrabajo:true, especialidad:true, localidad:true, createdAt:true, updatedAt:true, sueldoPretendido:true } }),
      prisma.companyProfile.findMany({ orderBy: { updatedAt: 'desc' }, take: 80, select: { id:true, companyName:true, cuit:true, contactEmail:true, city:true, province:true, createdAt:true, updatedAt:true } }),
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
    ]);

    const uniqueEvents = (events) => {
      const seen = new Set();
      return (events || []).filter((ev) => {
        const key = [ev.type || '', ev.title || '', ev.actor || '', ev.context || '', ev.createdAt ? new Date(ev.createdAt).toISOString() : ''].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const candidateProfileEvents = (candidates || []).slice(0, 20).map((it) => {
      const createdAt = it.createdAt || it.updatedAt || new Date();
      const updatedAt = it.updatedAt || createdAt;
      const changed = Math.abs(new Date(updatedAt).getTime() - new Date(createdAt).getTime()) > 60_000;
      return {
        type: changed ? 'perfil_actualizado' : 'alta_candidato',
        createdAt: changed ? updatedAt : createdAt,
        title: `${it.apellido || ''}, ${it.nombre || ''}`.replace(/^,\s*/, '').trim() || 'Candidato',
        actor: `${it.nombre || ''} ${it.apellido || ''}`.trim() || 'Candidato',
        context: changed ? 'Perfil candidato actualizado' : 'Alta de candidato en bolsa',
      };
    });

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

    const companyProfileEvents = (companies || []).slice(0, 20).map((it) => {
      const createdAt = it.createdAt || it.updatedAt || new Date();
      const updatedAt = it.updatedAt || createdAt;
      const changed = Math.abs(new Date(updatedAt).getTime() - new Date(createdAt).getTime()) > 60_000;
      return {
        type: changed ? 'empresa_actualizada' : 'alta_empresa',
        createdAt: changed ? updatedAt : createdAt,
        title: it.companyName || 'Empresa',
        actor: it.companyName || 'Empresa',
        context: changed ? 'Perfil empresa actualizado' : 'Alta de empresa en el portal',
      };
    });

    const companyOrderEvents = (companyRecentOrders || []).map((it) => ({
      type: 'documento',
      createdAt: it.createdAt,
      title: it.documentNo || buildInternalTicketNumber(it.id),
      actor: it.company?.companyName || 'Empresa',
      context: statusLabel(it.status),
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

    return res.json({
      ok: true,
      summary: { candidateCount, companyCount, jobsCount, applicationCount, orderCount, paidTotal: Number(paidTotal?._sum?.total || 0) },
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
          ]).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
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
          ]).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50),
        },
      },
      candidates, companies, threads: recentThreads
    });
  } catch (err) {
    console.error('GET /admin/bootstrap', err);
    return res.status(500).json({ error: 'No se pudo cargar el panel general.' });
  }
});

app.get('/admin/chat/threads', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const rows = await prisma.supportThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 100, include: { company: { select: { companyName: true } }, user: { select: { email: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 100 } } }).catch(() => []);
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('GET /admin/chat/threads', err);
    return res.status(500).json({ error: 'No se pudo cargar el chat operador.' });
  }
});

app.post('/admin/chat/reply', auth, requireAnyRole(['ADMIN','SUPERADMIN']), async (req, res) => {
  try {
    const threadId = String(req.body?.threadId || '').trim();
    const content = clampText(String(req.body?.content || ''), 4000);
    const reusable = !!req.body?.reusable;
    if(!threadId || !content) return res.status(400).json({ error: 'Faltan datos para responder.' });
    const thread = await prisma.supportThread.findUnique({ where: { id: threadId }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if(!thread) return res.status(404).json({ error: 'Conversación no encontrada.' });
    await prisma.supportMessage.create({ data: { threadId, actor: 'OPERATOR', content, reusable } });
    await prisma.supportThread.update({ where: { id: threadId }, data: { needsHuman: false, status: 'WAITING_USER', lastAiMessage: content } }).catch(() => null);
    if(reusable){
      const userPrompt = thread.messages.find((m)=> m.actor === 'USER')?.content || thread.lastUserMessage || content;
      const keywords = Array.from(new Set(normalizeName(userPrompt).split(' ').filter((tok)=> tok.length >= 4))).slice(0,12);
      await prisma.supportKnowledge.create({ data: { scope: thread.role, keywords, questionSample: userPrompt.slice(0,180), answer: content, source: 'operator', isActive: true } }).catch(() => null);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /admin/chat/reply', err);
    return res.status(500).json({ error: 'No se pudo enviar la respuesta del operador.' });
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

const PORT = process.env.PORT || 10000;
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (IS_MAIN) {
  app.listen(PORT, "0.0.0.0", () => console.log("Talento PyME API escuchando en", PORT, "(v"+APP_VERSION+")"));
}

export { app, prisma };
