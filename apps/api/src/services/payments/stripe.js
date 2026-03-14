import crypto from 'node:crypto';
import { PaymentProviderError, safeJsonParse } from './provider.js';

function parseStripeSignature(header = '') {
  const result = { timestamp: null, signatures: [] };
  for (const part of String(header || '').split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't') result.timestamp = value;
    if (key === 'v1' && value) result.signatures.push(value);
  }
  return result;
}

function makeStripeSignature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

function timingSafeEq(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createStripeCheckoutProvider(config = {}) {
  const apiKey = String(config.apiKey || '').trim();
  const webhookSecret = String(config.webhookSecret || '').trim();
  const appBaseUrl = String(config.appBaseUrl || '').replace(/\/$/, '');
  const currency = String(config.currency || 'ars').trim().toLowerCase();
  const successUrl = String(config.successUrl || `${appBaseUrl}/factory.html?payment=success`).trim();
  const cancelUrl = String(config.cancelUrl || `${appBaseUrl}/factory.html?payment=cancel`).trim();
  const apiBaseUrl = String(config.apiBaseUrl || 'https://api.stripe.com/v1').replace(/\/$/, '');

  async function createCheckoutSession({ order }) {
    if (!apiKey) throw new PaymentProviderError('PAYMENT_PROVIDER_API_KEY es obligatorio para Stripe Checkout.', 500, 'STRIPE_KEY_REQUIRED');
    if (!appBaseUrl) throw new PaymentProviderError('APP_BASE_URL es obligatorio para Stripe Checkout.', 500, 'APP_BASE_URL_REQUIRED');

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${successUrl}${successUrl.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(order.id)}&provider=stripe_checkout&session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${cancelUrl}${cancelUrl.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(order.id)}&provider=stripe_checkout`);
    params.set('client_reference_id', order.id);
    params.set('customer_email', order.billingEmail || '');
    params.set('currency', currency);
    params.set('metadata[orderId]', order.id);
    params.set('metadata[companyId]', order.companyId);
    params.set('metadata[source]', 'talento-pyme');
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', currency);
    params.set('line_items[0][price_data][unit_amount]', String(Math.max(0, Number(order.total || 0))));
    params.set('line_items[0][price_data][product_data][name]', `Talento PyME · ${order.itemsSummary || 'Planes Factory'}`);
    params.set('line_items[0][price_data][product_data][description]', `${order.totalDays || 0} días · ${order.totalPublications || 0} publicaciones · ${order.totalOpenings || 0} búsquedas`);

    const response = await fetch(`${apiBaseUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const text = await response.text();
    const data = safeJsonParse(text, null);
    if (!response.ok || !data?.id || !data?.url) {
      throw new PaymentProviderError(data?.error?.message || 'Stripe Checkout no pudo crear la sesión de pago.', 502, 'STRIPE_CREATE_SESSION_FAILED');
    }

    return {
      provider: 'stripe_checkout',
      checkoutUrl: data.url,
      sessionId: data.id,
      providerOrderId: data.id,
      raw: { id: data.id, payment_status: data.payment_status || null },
    };
  }

  async function getPaymentStatus(reference) {
    if (!apiKey) throw new PaymentProviderError('PAYMENT_PROVIDER_API_KEY es obligatorio para Stripe Checkout.', 500, 'STRIPE_KEY_REQUIRED');
    const sessionId = String(reference || '').trim();
    if (!sessionId) throw new PaymentProviderError('La sesión de pago es obligatoria.', 400, 'SESSION_ID_REQUIRED');
    const response = await fetch(`${apiBaseUrl}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const text = await response.text();
    const data = safeJsonParse(text, null);
    if (!response.ok || !data?.id) {
      throw new PaymentProviderError(data?.error?.message || 'No se pudo consultar el estado del pago en Stripe.', 502, 'STRIPE_GET_SESSION_FAILED');
    }
    return {
      provider: 'stripe_checkout',
      status: String(data.payment_status || '').toUpperCase() === 'PAID' ? 'PAID' : 'PENDING_PAYMENT',
      sessionId: data.id,
      paymentProviderRef: data.payment_intent || null,
      raw: data,
    };
  }

  function verifyWebhook(signatureHeader, rawBody) {
    if (!webhookSecret) throw new PaymentProviderError('PAYMENT_PROVIDER_WEBHOOK_SECRET es obligatorio para Stripe Checkout.', 500, 'STRIPE_WEBHOOK_SECRET_REQUIRED');
    const parsed = parseStripeSignature(signatureHeader);
    if (!parsed.timestamp || !parsed.signatures.length) return false;
    const expected = makeStripeSignature(webhookSecret, parsed.timestamp, rawBody);
    return parsed.signatures.some((sig) => timingSafeEq(sig, expected));
  }

  function parseWebhookEvent(rawEvent) {
    const payload = typeof rawEvent === 'string' ? safeJsonParse(rawEvent, null) : rawEvent;
    if (!payload || typeof payload !== 'object') throw new PaymentProviderError('Webhook Stripe inválido.', 400, 'INVALID_STRIPE_WEBHOOK');
    const object = payload?.data?.object || {};
    const type = String(payload.type || '').trim();
    let outcome = 'PENDING_PAYMENT';
    if (type === 'checkout.session.completed') outcome = 'PAID';
    else if (type === 'checkout.session.expired') outcome = 'EXPIRED';
    else if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') outcome = 'FAILED';
    else if (type === 'checkout.session.async_payment_succeeded') outcome = 'PAID';

    return {
      provider: 'stripe_checkout',
      providerEventId: String(payload.id || '').trim(),
      eventType: type,
      orderId: String(object?.metadata?.orderId || object?.client_reference_id || '').trim() || null,
      outcome,
      paymentProviderRef: object?.payment_intent || object?.id || null,
      paymentSessionRef: object?.id || null,
      amount: Number(object?.amount_total || 0) || null,
      currency: String(object?.currency || '').trim().toLowerCase() || null,
      cardBrand: null,
      cardLast4: null,
      failureReason: object?.status || payload?.data?.object?.last_payment_error?.message || null,
      receiptUrl: null,
      raw: payload,
    };
  }

  return {
    name: 'stripe_checkout',
    createCheckoutSession,
    getPaymentStatus,
    verifyWebhook,
    parseWebhookEvent,
  };
}
