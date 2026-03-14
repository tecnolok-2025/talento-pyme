import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNoCardData, sanitizeCheckoutPayloadForLog } from '../src/services/payments/provider.js';
import { createStripeCheckoutProvider } from '../src/services/payments/stripe.js';
import { createMockRedirectProvider } from '../src/services/payments/mock-redirect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

function stripeSignature(secret, rawBody, timestamp = '1700000000') {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

test('rechaza payment.cardNumber en checkout guard', () => {
  assert.throws(() => assertNoCardData({ payment: { cardNumber: '4111111111111111' } }), /no acepta datos de tarjeta/i);
});

test('rechaza payment.cvv en checkout guard', () => {
  assert.throws(() => assertNoCardData({ payment: { cvv: '123' } }), /no acepta datos de tarjeta/i);
});

test('sanitizeCheckoutPayloadForLog no expone PAN ni CVV', () => {
  const safe = sanitizeCheckoutPayloadForLog({
    couponCode: 'DESC10',
    billing: { razonSocial: 'Empresa SA', cuit: '30700000001', email: 'facturacion@empresa.com' },
    payment: { cardNumber: '4111111111111111', cvv: '123' }
  });
  const dump = JSON.stringify(safe);
  assert.equal(safe.containsForbiddenPaymentFields, true);
  assert.ok(!dump.includes('4111111111111111'));
  assert.ok(!dump.includes('123'));
});

test('stripe provider verifica webhook válido y parsea checkout.session.completed', () => {
  const secret = 'whsec_test_secret';
  const provider = createStripeCheckoutProvider({ apiKey: 'sk_test_x', webhookSecret: secret, appBaseUrl: 'https://talento.test', currency: 'ars' });
  const event = {
    id: 'evt_123',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_123', client_reference_id: 'ord_1', amount_total: 60500, currency: 'ars', payment_intent: 'pi_1', metadata: { orderId: 'ord_1' } } }
  };
  const rawBody = JSON.stringify(event);
  const header = stripeSignature(secret, rawBody);
  assert.equal(provider.verifyWebhook(header, rawBody, {}), true);
  const parsed = provider.parseWebhookEvent(rawBody);
  assert.equal(parsed.outcome, 'PAID');
  assert.equal(parsed.orderId, 'ord_1');
  assert.equal(parsed.paymentSessionRef, 'cs_test_123');
});

test('stripe provider rechaza webhook con firma inválida', () => {
  const provider = createStripeCheckoutProvider({ apiKey: 'sk_test_x', webhookSecret: 'whsec_test_secret', appBaseUrl: 'https://talento.test', currency: 'ars' });
  const rawBody = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: { id: 'cs_bad', client_reference_id: 'ord_bad' } } });
  assert.equal(provider.verifyWebhook('t=1700000000,v1=deadbeef', rawBody, {}), false);
});

test('mock redirect genera checkoutUrl sin tocar tarjeta', async () => {
  const provider = createMockRedirectProvider({ appBaseUrl: 'https://talento.test', webhookSecret: 'mock_secret' });
  const session = await provider.createCheckoutSession({ order: { id: 'ord_mock' } });
  assert.equal(session.provider, 'mock_redirect');
  assert.match(session.checkoutUrl, /factory\.html\?payment=pending/);
});

test('factory.html no contiene inputs operativos de tarjeta', async () => {
  const html = await fs.readFile(path.join(root, 'apps/web/factory.html'), 'utf8');
  const forbidden = ['id="cardNumber"', 'id="cardCvv"', 'id="cardExpiry"', 'autocomplete="cc-number"', 'autocomplete="cc-csc"'];
  forbidden.forEach((snippet) => assert.ok(!html.includes(snippet), `Se encontró ${snippet}`));
});

test('service worker excluye endpoints sensibles de caché', async () => {
  const sw = await fs.readFile(path.join(root, 'apps/web/sw.js'), 'utf8');
  assert.ok(sw.includes("url.pathname.startsWith('/payments/')"));
  assert.ok(sw.includes("url.pathname.startsWith('/factory/')"));
  assert.ok(sw.includes("accept.includes('application/json')"));
});
