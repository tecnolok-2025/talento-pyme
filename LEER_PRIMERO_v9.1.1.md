# Talento PyME v9.1.1 — leer antes de instalar

Este paquete corrige consultas automáticas frecuentes y agrega una pantalla de mantenimiento. Se preparó a partir del paquete v9.1.0 adjunto.

## Qué contiene

- Proyecto completo actualizado.
- Parche acumulativo v9.1.0 → v9.1.1.
- Auditoría de consumo Neon.
- Sin cambios a la base, el esquema Prisma o las migraciones.

## Configuración de Render para la API

En `talento-pyme-api` → **Settings** → **Build & Deploy**:

| Campo | Valor de v9.1.1 |
|---|---|
| Root Directory | `apps/api` |
| Build Command | `npm install && npm run build` |
| Pre-Deploy Command | Vacío |
| Start Command | `npm start` |
| Branch | `main` |

El Build Command actual de la captura incluye `prisma db push --accept-data-loss`. Hay que quitarlo: puede modificar el esquema de producción durante cada build. El comando `npm start` tampoco aplicará migraciones automáticamente en v9.1.1. No ejecutar `db:push:dev` ni `db:migrate:safe` como parte de este cambio.

En `talento-pyme` → **Settings** → **Build & Deploy**, el sitio estático debe seguir publicando `apps/web` con `.` como Publish Directory. La pantalla de mantenimiento está en `apps/web/maintenance.html`; para que los usuarios la vean, hay que actualizar y desplegar también el servicio web.

## Variables nuevas opcionales

No son obligatorias. El código usa esos valores por defecto si no se agregan:

- `COMMUNICATION_WORKER_RECOVERY_HOURS=6`
- `SUPPORT_MAILBOX_SYNC_INTERVAL_MINUTES=360`
- `ADMIN_BACKUP_CHECK_MINUTES=360`
- `CANDIDATE_CLASSIFICATION_SCAN_SECONDS=21600`
- `CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS=24`

No copies ni compartas valores secretos. No es necesario crear una segunda variable `DATABASE_URL` para este parche.

## Qué esperar

La pantalla de mantenimiento del sitio web permite explicar la interrupción aunque la API o Neon no respondan. El botón de reintento realiza una única comprobación al ser pulsado; no mantiene una consulta periódica a Neon. Si la base sigue archivada o limitada, la pantalla continúa en mantenimiento. Este parche no vuelve a habilitar el compute agotado ni cambia el plan de Neon.

El cambio de código no toca registros; aun así, el procedimiento de producción del proyecto requiere obtener y verificar una copia completa antes de modificar infraestructura o ejecutar cualquier operación de base de datos. No hay respaldo externo verificado dentro del paquete recibido.

## Rollback de código

Volver a desplegar el commit/paquete v9.1.0 restaura la lógica anterior. Las migraciones y el esquema no cambian entre estas dos versiones. No se necesita una migración inversa. Mantener el Build Command seguro (`npm install && npm run build`) durante el rollback: no volver a agregar `db push --accept-data-loss`.
