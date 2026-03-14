# Render / variables de entorno — Talento PyME v5.6.2

## Backend (servicio API)

Configurar en Render > API > Environment:

- `APP_BASE_URL=https://tu-dominio`
- `PAYMENT_PROVIDER=stripe_checkout`
- `PAYMENT_PROVIDER_API_KEY=sk_live_o_sk_test`
- `PAYMENT_PROVIDER_PUBLIC_KEY=pk_live_o_pk_test`
- `PAYMENT_PROVIDER_WEBHOOK_SECRET=whsec_...`
- `PAYMENT_SUCCESS_URL=https://tu-dominio/factory.html?payment=success`
- `PAYMENT_CANCEL_URL=https://tu-dominio/factory.html?payment=cancel`
- `PAYMENT_WEBHOOK_URL=https://tu-dominio/payments/webhook/provider`
- `PAYMENT_CURRENCY=ARS`
- `PAYMENT_MODE=production`

## Admin comercial existente

- `FACTORY_ADMIN_ALIAS=TalentoPyme`
- `FACTORY_ADMIN_PASSWORD=tu_clave`
- `FACTORY_SUPPORT_EMAIL=factory@gmail.com`
- `FACTORY_ADMIN_ALLOWED_COMPANIES=Mengabo SA,Mengabo Sociedad Anonima`

## Despliegue

1. guardar variables
2. redeploy del servicio API
3. correr build habitual:
   - `npm install`
   - `npx prisma generate`
   - `npx prisma db push --accept-data-loss`
4. configurar el webhook del proveedor apuntando a:
   - `/payments/webhook/provider`

## Modo de prueba seguro

Si todavía no está definida la pasarela real, solo para desarrollo se puede usar:
- `PAYMENT_PROVIDER=mock_redirect`
- `PAYMENT_MODE=test`

Ese modo NO pide tarjeta y NO debe usarse en producción.
