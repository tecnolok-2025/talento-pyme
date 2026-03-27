import crypto from 'node:crypto';

export class PaymentSecurityError extends Error {
  constructor(message, statusCode = 400, code = 'PAYMENT_SECURITY_ERROR') {
    super(message);
    this.name = 'PaymentSecurityError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class PaymentProviderError extends Error {
  constructor(message, statusCode = 502, code = 'PAYMENT_PROVIDER_ERROR') {
    super(message);
    this.name = 'PaymentProviderError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const FORBIDDEN_PAYMENT_KEYS = new Set([
  'cardnumber',
  'pan',
  'cvv',
  'cvc',
  'expiry',
  'exp',
  'expmonth',
  'expyear',
  'cardholder',
  'cardholderdni',
  'cardbrand',
  'trackdata',
  'track1',
  'track2',
  'paymentmethoddata',
]);

const SENSITIVE_TEXT_PATTERNS = [
  /\b\d{12,19}\b/,
  /\b\d{2}\/\d{2,4}\b/,
  /\b(cvv|cvc|pan|card number|numero de tarjeta)\b/i,
];

export function listForbiddenPaymentFields(payload = {}) {
  const hits = [];
  const visited = new Set();
  function walk(value, path = '', depth = 0) {
    if (value == null || depth > 4) return;
    if (typeof value === 'string') {
      if (path && SENSITIVE_TEXT_PATTERNS.some((rx) => rx.test(value))) hits.push(path);
      return;
    }
    if (typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${path}[${idx}]`, depth + 1));
      return;
    }
    for (const [rawKey, nested] of Object.entries(value)) {
      const key = String(rawKey || '').trim();
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const nextPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_PAYMENT_KEYS.has(normalized)) {
        hits.push(nextPath);
      }
      walk(nested, nextPath, depth + 1);
    }
  }
  walk(payload);
  return Array.from(new Set(hits));
}

export function assertNoCardData(payload = {}) {
  const fields = listForbiddenPaymentFields(payload);
  if (fields.length) {
    throw new PaymentSecurityError('Talento PyME no acepta datos de tarjeta en este endpoint', 400, 'CARD_DATA_NOT_ALLOWED');
  }
}

export function sanitizeCheckoutPayloadForLog(payload = {}) {
  const billing = payload?.billing || {};
  return {
    hasItems: Array.isArray(payload?.items) ? payload.items.length : 0,
    couponCode: payload?.couponCode ? String(payload.couponCode).slice(0, 40) : null,
    billing: {
      razonSocial: billing?.razonSocial ? '[present]' : '[missing]',
      cuit: billing?.cuit ? '[present]' : '[missing]',
      email: billing?.email ? '[present]' : '[missing]',
    },
    containsForbiddenPaymentFields: listForbiddenPaymentFields(payload).length > 0,
  };
}

export function sha256Hex(input = '') {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

export function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
