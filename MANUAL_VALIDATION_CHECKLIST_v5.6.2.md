# Checklist manual de validación — Talento PyME v5.6.2

## Frontend
- Abrir `factory.html`
- Inspeccionar el DOM
- Confirmar que NO existan inputs:
  - `cardNumber`
  - `cardCvv`
  - `cardExpiry`
  - `cardHolder`
  - `cardHolderDni`
  - `cardBrand`

## Red / navegador
- Abrir DevTools > Network
- Confirmar compra desde Factory
- Verificar que el request a `/factory/checkout` NO incluya:
  - PAN
  - CVV
  - expiry
  - cardHolder
  - cardBrand
- Verificar que la respuesta incluya `checkoutUrl`
- Verificar redirect al proveedor

## Backend
- Enviar payload malicioso a `/factory/checkout` con `payment.cardNumber`
- Confirmar respuesta `400` con mensaje:
  - `Talento PyME no acepta datos de tarjeta en este endpoint`

## Logs
- Revisar logs de backend
- Confirmar que no aparezcan PAN/CVV/expiry
- Confirmar evento de seguridad `CARD_DATA_REJECTED` si se probó payload malicioso

## Webhook
- Enviar webhook firmado válido
- Confirmar transición a `PAID`
- Reenviar el mismo webhook
- Confirmar respuesta idempotente y registro de replay
- Enviar webhook con firma inválida
- Confirmar `400`

## PWA / caché
- Verificar que el service worker no cachee:
  - `/factory/checkout`
  - `/payments/webhook/provider`
  - `/factory/orders/:id/status`
  - respuestas JSON sensibles
