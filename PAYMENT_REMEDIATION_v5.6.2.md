# Talento PyME v5.6.2 — remediación integral de pagos, seguridad y gobernanza

## 1. Resumen ejecutivo

Se ejecutó una remediación real sobre la base `v5.6.1` para eliminar el manejo directo de datos de tarjeta dentro de Talento PyME y reemplazarlo por un flujo de **pedido interno + checkout externo + webhook firmado**.

Resultado principal:
- el frontend propio ya no pide PAN, CVV ni vencimiento;
- `POST /factory/checkout` rechaza explícitamente cualquier intento de mandar datos de tarjeta;
- se eliminó la simulación local de pago por tarjeta;
- las órdenes nacen como `PENDING_PAYMENT`;
- el pase a `PAID` ocurre únicamente por webhook válido del proveedor;
- se agregó trazabilidad de seguridad y de webhooks;
- el PWA deja fuera de caché los endpoints sensibles de checkout/pagos.

## 2. Hallazgos del flujo actual (base auditada v5.6.1)

### Hallazgos bloqueantes de producción

1. `apps/web/factory.html`
   - líneas aprox. 231-237
   - inputs operativos de tarjeta: `cardBrand`, `cardNumber`, `cardHolder`, `cardHolderDni`, `cardExpiry`, `cardCvv`
   - riesgo: exposición directa de PAN/CVV/expiry en frontend propio
   - acción aplicada: eliminación del DOM y del flujo asociado

2. `apps/web/factory.html`
   - línea aprox. 836
   - payload `payment` con datos de tarjeta hacia `/factory/checkout`
   - riesgo: transmisión de datos de tarjeta al backend propio
   - acción aplicada: payload reducido a `items`, `couponCode`, `billing`

3. `apps/api/src/index.js`
   - línea aprox. 2282
   - endpoint `POST /factory/checkout`
   - riesgo: aceptación y procesamiento de tarjeta en backend
   - acción aplicada: guard clause de seguridad + rediseño a orden pendiente + sesión externa

4. `apps/api/src/index.js`
   - líneas aprox. 131-196
   - funciones `luhnCheck`, `detectCardBrand`, `parseExpiry`, `simulateFactoryPayment`
   - riesgo: lógica local de autorización falsa y tratamiento directo de tarjeta
   - acción aplicada: eliminación completa

5. `apps/api/prisma/schema.prisma`
   - líneas aprox. 265-267
   - campos `cardBrand`, `cardLast4`, `paymentNote`
   - riesgo: diseño orientado a simulación local; conservación de rastros innecesarios
   - acción aplicada: se preservan `cardBrand` y `cardLast4` solo para datos mínimos que entregue el proveedor; `paymentNote` queda deprecado y sin uso nuevo

### Hallazgos adicionales

6. `apps/web/factory-inline.js` y `apps/web/factory-extracted.js`
   - contenían copias del flujo inseguro con lectura de campos de tarjeta y payload `payment`
   - acción aplicada: eliminación de archivos obsoletos

7. `apps/web/sw.js`
   - estrategia anterior cacheaba respuestas same-origin sin distinguir rutas sensibles
   - riesgo: persistencia local de respuestas de checkout/billing
   - acción aplicada: exclusión explícita de `/factory/`, `/payments/`, `/admin/`, `/support/` y JSON sensible

## 3. Riesgos críticos

- tratamiento directo de tarjeta fuera de pasarela PCI
- aprobación local falsa de pagos
- posibilidad de que PAN/CVV viajara desde navegador a backend propio
- estados `PAID` sin confirmación externa verificable
- riesgo de trazas/logs inseguros y caché de endpoints sensibles
- falta de idempotencia y control de replay en webhooks

## 4. Diseño objetivo propuesto

Flujo objetivo implementado:
1. el usuario arma el carrito en Factory;
2. Talento PyME crea una orden interna `PENDING_PAYMENT`;
3. Talento PyME crea una sesión de checkout con proveedor externo;
4. el frontend redirige al `checkoutUrl` del proveedor;
5. el proveedor cobra y notifica por webhook firmado;
6. Talento PyME verifica firma + idempotencia + monto + orden;
7. la orden pasa a `PAID`, `FAILED`, `EXPIRED` o `CANCELLED`;
8. se actualiza la capacidad operativa solo a partir de órdenes `PAID`.

## 5. Plan de remediación por fases

### Fase 1 — bloqueo inmediato
- eliminar inputs de tarjeta
- bloquear payloads con tarjeta
- eliminar simulación local

### Fase 2 — checkout externo
- crear orden pendiente
- desacoplar proveedor en `services/payments/`
- devolver `checkoutUrl`

### Fase 3 — confirmación segura
- webhook dedicado
- validación de firma
- idempotencia
- logging de seguridad

### Fase 4 — endurecimiento operativo
- no cachear checkout/pagos
- checklist manual y tests automáticos
- documentación de variables de entorno

## 6. Cambios concretos de frontend

### `apps/web/factory.html`
- eliminado DOM de tarjeta
- eliminado payload `payment`
- reemplazado mensaje por:
  - “Pedido creado”
  - “Serás redirigido a una pasarela segura para completar el pago”
  - “Talento PyME no procesa directamente los datos de tu tarjeta”
- agregado manejo de retorno `payment=success|cancel`
- agregado estado `PENDING_PAYMENT`, `FAILED`, `EXPIRED`, `CANCELLED`
- eliminado detalle visual de “tarjeta/autorización simulada”

### `apps/web/sw.js`
- no cachea rutas de pagos/factory/admin/support
- no cachea respuestas JSON sensibles
- no cachea requests no-GET

## 7. Cambios concretos de backend

### `apps/api/src/index.js`
- `POST /factory/checkout`
  - ahora rechaza tarjeta con 400
  - crea orden `PENDING_PAYMENT`
  - llama al proveedor
  - guarda refs mínimas de la sesión
  - devuelve `checkoutUrl`
- nuevo `GET /factory/orders/:orderId/status`
- nuevo `POST /payments/webhook/provider`
  - raw body
  - verificación de firma
  - idempotencia
  - control de replay
  - control de monto
  - transición de estado por webhook
- agregado registro de eventos de seguridad
- eliminado uso de `simulateFactoryPayment`, `luhnCheck`, `detectCardBrand`, `parseExpiry`

## 8. Cambios concretos de Prisma / DB

### BillingOrder
Se agregaron:
- `paymentProvider`
- `paymentSessionRef`
- `paymentProviderRef`
- `paymentApprovedAt`
- `paymentFailureReason`
- `paymentReceiptUrl`

Se mantienen:
- `cardBrand`
- `cardLast4`
solo para metadatos mínimos que entregue el proveedor, nunca derivados de un PAN recibido por Talento PyME.

### Nuevos modelos
- `PaymentWebhookEvent`
  - idempotencia y auditoría de webhooks
- `SecurityEvent`
  - trazabilidad operativa y de seguridad

### Estados
`BillingOrderStatus` queda en:
- `DRAFT`
- `PENDING_PAYMENT`
- `PAID`
- `FAILED`
- `EXPIRED`
- `CANCELLED`

## 9. Estructura propuesta para integración del proveedor

Se agregó:
- `apps/api/src/services/payments/provider.js`
- `apps/api/src/services/payments/index.js`
- `apps/api/src/services/payments/stripe.js`
- `apps/api/src/services/payments/mock-redirect.js`

Capa abstracta:
- `createCheckoutSession(order)`
- `getPaymentStatus(reference)`
- `verifyWebhook(signature, rawBody, headers)`
- `parseWebhookEvent(rawEvent)`

## 10. Tests

Automáticos agregados:
- rechazo de `payment.cardNumber`
- rechazo de `payment.cvv`
- sanitización de logs
- verificación de firma de webhook Stripe
- rechazo de webhook inválido
- creación de `checkoutUrl` sin tocar tarjeta
- inspección del DOM para asegurar ausencia de inputs de tarjeta
- verificación de exclusión de caché sensible en PWA

Resultado ejecutado en la remediación:
- `8/8` tests OK

## 11. Variables de entorno

Backend:
- `PAYMENT_PROVIDER`
- `PAYMENT_PROVIDER_API_KEY`
- `PAYMENT_PROVIDER_WEBHOOK_SECRET`
- `PAYMENT_PROVIDER_PUBLIC_KEY`
- `PAYMENT_SUCCESS_URL`
- `PAYMENT_CANCEL_URL`
- `PAYMENT_WEBHOOK_URL`
- `PAYMENT_CURRENCY`
- `PAYMENT_MODE`
- `APP_BASE_URL`

No deben exponerse al frontend:
- `PAYMENT_PROVIDER_API_KEY`
- `PAYMENT_PROVIDER_WEBHOOK_SECRET`
- claves administrativas privadas

## 12. Diffs / bloques de cambio clave

- eliminación total del bloque de tarjeta en `apps/web/factory.html`
- guard clause de seguridad al inicio de `POST /factory/checkout`
- nuevo webhook firmado `POST /payments/webhook/provider`
- nuevo adaptador de proveedor en `services/payments/`
- nuevo esquema de persistencia de sesión/ref/eventos

## 13. Checklist final de validación

- [x] no hay inputs operativos de tarjeta en el frontend propio
- [x] no se envía `payment.cardNumber`, `payment.cvv` ni `payment.expiry`
- [x] `/factory/checkout` rechaza datos de tarjeta
- [x] ya no existe la simulación local de tarjeta
- [x] la orden nace como `PENDING_PAYMENT`
- [x] el pago pasa a `PAID` solo por webhook válido
- [x] no se guarda PAN/CVV/expiry en base
- [x] no se cachean endpoints sensibles en PWA
- [x] se agregó trazabilidad de seguridad y webhook
- [x] quedó base preparada para proveedor PCI externo

## Notas de despliegue

1. correr `npx prisma generate`
2. correr `npx prisma db push --accept-data-loss`
3. configurar variables de entorno de pagos
4. desplegar backend
5. validar redirect + webhook en entorno test del proveedor
