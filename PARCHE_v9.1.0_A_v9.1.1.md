# Parche acumulativo — Talento PyME v9.1.0 → v9.1.1

## Archivos modificados

- `apps/api/package.json` y `package-lock.json`: versión 9.1.1; se elimina `prestart`; build solo genera Prisma Client.
- `apps/api/src/index.js`: colas por evento, frecuencias de respaldo, estado de conectividad, chequeo puntual, sincronización IMAP espaciada, inicio sin migraciones automáticas y cierre de Prisma.
- `apps/api/.env.example` y `.env.example`: documentan intervalos nuevos.
- `apps/api/test/neon-compute-guards-v911.test.js`: pruebas de regresión estáticas.
- `apps/web/auth.js`: detecta indisponibilidad y abre la pantalla de mantenimiento.
- `apps/web/maintenance.html`: página de estado con reintento manual.
- `apps/web/sw.js`: versión nueva y precarga de la pantalla de mantenimiento.
- `apps/web/admin.html`: menos consultas de refresco y aclaración visible de que el JSON local no es un respaldo externo completo.
- Páginas web activas: número de versión de recursos actualizado a 9.1.1.

## Archivos que no se modifican

- `apps/api/prisma/schema.prisma`.
- Los seis archivos bajo `apps/api/prisma/migrations/`.
- Ninguna base, tabla, fila, candidato, empresa, cuenta, configuración o auditoría de producción.

## Instalación

Aplicar los archivos del ZIP de parche conservando sus rutas relativas en el repositorio `tecnolok-2025/talento-pyme`, revisar el diff, y luego seguir `LEER_PRIMERO_v9.1.1.md`. Actualizar ambos servicios de Render (API y web). No ejecutar comandos de migración ni `prisma db push` durante este parche.
