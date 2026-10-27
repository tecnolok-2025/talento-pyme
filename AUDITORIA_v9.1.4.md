# Auditoría de Talento PyME v9.1.4

## Hallazgos y cambios
- `npm start` continúa ejecutando `node src/index.js`; las migraciones siguen fuera del arranque normal.
- La clasificación conserva su procesamiento inmediato por evento. Se extiende el control periódico incremental de 6 a 12 horas; el barrido general continúa diario.
- La sincronización automática de la bandeja pasa de 6 a 12 horas; existe sincronización manual.
- La recuperación periódica de colas pasa de 6 a 12 horas; el disparo normal de la cola ante un trabajo nuevo sigue activo.
- Se conserva la revisión de respaldos cada 6 horas. La generación se mantiene como máximo diaria.
- Los mínimos nuevos se aplican aunque haya variables antiguas en Render; valores superiores de 12 horas se respetan hasta un máximo de 24 horas.
- El panel de bienvenida introducido en el borrador es de solo lectura.

## Verificación
- `node --check` pasó en los archivos JavaScript modificados; los archivos JSON validan correctamente.
- Las 4 pruebas específicas de arranque, health, mantenimiento y frecuencias automáticas pasan.
- La suite histórica completa conserva 45 fallas y 304 aprobaciones, igual que la versión 9.1.3 base; contiene comprobaciones heredadas con expectativas de versiones anteriores y una dependencia de prueba `bcryptjs` no instalada en este entorno.

## Integridad de datos
No se modifica `schema.prisma`, no se agregan ni borran migraciones, y no hay escrituras o conversiones masivas de datos. Las modificaciones reducen únicamente la frecuencia de tareas programadas.

## Instalación y reversión
El cambio requiere desplegar API y web. Conservar el despliegue 9.1.3 en Render para poder hacer rollback. Para revertir, volver al deploy anterior; no restaurar snapshots ni ejecutar SQL.

## Límite de la auditoría
El código permite verificar el comportamiento programado, pero la reducción efectiva de CU-hours solo se confirma comparando métricas de Neon luego del despliegue, con el mismo patrón de uso.
