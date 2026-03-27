import crypto from 'node:crypto';
import { PaymentProviderError, safeJsonParse } from './provider.js';

function signMockWebhook(secret, rawBody, timestamp) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

function parseSignatureHeader(header = '') {
  const parts = String(header || '').split(',').map((chunk) => chunk.trim()).filter(Boolean);
  const out = { t: null, v1: [] };
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') out.t = value;
    if (key === 'v1' && value) out.v1.push(value);
  }
  return out;
}

export function createMockRedirectProvider(config = {}) {
  const appBaseUrl = String(config.appBaseUrl || '').replace(/\/$/, '');
  const webhookSecret = String(config.webhookSecret || '').trim();
  return {
    name: 'mock_redirect',
    async createCheckoutSession({ order }) {
      if (!appBaseUrl) throw new PaymentProviderError('APP_BASE_URL es obligatorio para mock_redirect.', 500, 'APP_BASE_URL_REQUIRED');
      return {
        provider: 'mock_redirect',
        checkoutUrl: `${appBaseUrl}/factory.html?payment=pending&orderId=${encodeURIComponent(order.id)}&provider=mock_redirect`,
        sessionId: `mockcs_${order.id}`,
        providerOrderId: `mockord_${order.id}`,
      };
    },
    async getPaymentStatus() {
      return { provider: 'mock_redirect', status: 'PENDING_PAYMENT' };
    },
    verifyWebhook(signatureHeader, rawBody) {
      if (!webhookSecret) throw new PaymentProviderError('PAYMENT_PROVIDER_WEBHOOK_SECRET es obligatorio para mock_redirect.', 500, 'WEBHOOK_SECRET_REQUIRED');
      const parsed = parseSignatureHeader(signatureHeader);
      if (!parsed.t || !parsed.v1.length) return false;
      const expected = signMockWebhook(webhookSecret, rawBody, parsed.t);
      return parsed.v1.some((sig) => sig === expected);
    },
    parseWebhookEvent(rawEvent) {
      const payload = typeof rawEvent === 'string' ? safeJsonParse(rawEvent, null) : rawEvent;
      if (!payload || typeof payload !== 'object') throw new PaymentProviderError('Webhook mock inválido.', 400, 'INVALID_MOCK_WEBHOOK');
      return {
        provider: 'mock_redirect',
        providerEventId: String(payload.id || '').trim() || `mockevt_${Date.now()}`,
        eventType: String(payload.type || 'mock.payment.updated'),
        orderId: String(payload.orderId || payload?.data?.orderId || '').trim() || null,
        outcome: String(payload.outcome || payload?.data?.outcome || '').trim().toUpperCase() || 'PENDING_PAYMENT',
        paymentProviderRef: payload.providerPaymentId || null,
        paymentSessionRef: payload.sessionId || null,
        amount: Number(payload.amount || payload?.data?.amount || 0) || null,
        currency: String(payload.currency || payload?.data?.currency || '').trim().toLowerCase() || null,
        cardBrand: null,
        cardLast4: null,
        failureReason: payload.failureReason || payload?.data?.failureReason || null,
        receiptUrl: payload.receiptUrl || null,
        raw: payload,
      };
    }
  };
}
