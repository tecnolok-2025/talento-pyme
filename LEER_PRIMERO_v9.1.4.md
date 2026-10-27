# Talento PyME v9.1.4

## Cambios
Se amplía el panel administrativo de comunicaciones para mostrar el estado de bienvenida de los últimos 50 candidatos. La consulta es de solo lectura: no envía ni reintenta correos, no modifica datos y no ejecuta migraciones. Los ajustes de frecuencia solo cambian el momento de revisiones automáticas.

## Optimización de revisiones automáticas
- Clasificación periódica: cada 12 horas; la clasificación por evento al registrar o actualizar un perfil permanece inmediata y el barrido general continúa cada 24 horas.
- Sincronización automática del buzón: cada 12 horas; la sincronización manual permanece disponible.
- Recuperación de respaldo de la cola de correos: cada 12 horas; al crear una comunicación, la cola sigue iniciándose automáticamente.
- Respaldo de la base: se conserva la revisión cada 6 horas y la generación máxima diaria.
- Los intervalos mínimos aplican aunque Render conserve variables antiguas de 6 horas. Se pueden ampliar hasta 24 horas.

## Estados visibles
- Aceptado por el servidor de correo (no confirma la recepción en la bandeja).
- En cola / pendiente.
- Último intento con error.
- Sin seguimiento registrado.

## Instalación
La actualización requiere desplegar la API y la web desde el repositorio. Root Directory de Render API sigue siendo `apps/api`; Start Command `npm start`. La web debe desplegar la carpeta `apps/web` según la configuración actual del Static Site. No ejecutar `db:migrate:safe`, `db:push:dev` ni scripts de migración para esta versión.

Antes de publicar en producción, conservar el despliegue anterior de Render para rollback. No hay cambios de esquema ni de registros.
