import { PaymentProviderError } from './provider.js';
import { createMockRedirectProvider } from './mock-redirect.js';
import { createStripeCheckoutProvider } from './stripe.js';

export function getPaymentConfigFromEnv(env = process.env) {
  return {
    provider: String(env.PAYMENT_PROVIDER || '').trim() || (String(env.PAYMENT_PROVIDER_API_KEY || '').trim() ? 'stripe_checkout' : 'mock_redirect'),
    mode: String(env.PAYMENT_MODE || 'test').trim().toLowerCase(),
    apiKey: String(env.PAYMENT_PROVIDER_API_KEY || '').trim(),
    webhookSecret: String(env.PAYMENT_PROVIDER_WEBHOOK_SECRET || '').trim(),
    publicKey: String(env.PAYMENT_PROVIDER_PUBLIC_KEY || '').trim(),
    successUrl: String(env.PAYMENT_SUCCESS_URL || '').trim(),
    cancelUrl: String(env.PAYMENT_CANCEL_URL || '').trim(),
    webhookUrl: String(env.PAYMENT_WEBHOOK_URL || '').trim(),
    currency: String(env.PAYMENT_CURRENCY || 'ARS').trim().toLowerCase(),
    appBaseUrl: String(env.APP_BASE_URL || '').trim(),
  };
}

export function createPaymentProvider(config = getPaymentConfigFromEnv()) {
  const normalized = String(config.provider || '').trim().toLowerCase();
  if (normalized === 'stripe_checkout' || normalized === 'stripe' || normalized === 'stripe-hosted') {
    return createStripeCheckoutProvider(config);
  }
  if (normalized === 'mock_redirect' || normalized === 'mock') {
    if (String(config.mode || '').toLowerCase() === 'production') {
      throw new PaymentProviderError('mock_redirect no está habilitado en producción. Configurá un proveedor PCI real.', 500, 'MOCK_PROVIDER_DISABLED_IN_PRODUCTION');
    }
    return createMockRedirectProvider(config);
  }
  throw new PaymentProviderError(`Proveedor de pago no soportado: ${config.provider || 'sin definir'}`, 500, 'UNSUPPORTED_PAYMENT_PROVIDER');
}
