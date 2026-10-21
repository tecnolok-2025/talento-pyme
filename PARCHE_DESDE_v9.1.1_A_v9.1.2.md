# Parche Talento PyME v9.1.1 a v9.1.2

## Propósito

Completar la respuesta de mantenimiento cuando la API o PostgreSQL no estén disponibles, sin cambiar el esquema ni los datos.

## Archivos incluidos

Consultar `ARCHIVOS_MODIFICADOS.txt` para la lista completa de rutas.

## Cambios

- Se amplía la detección de fallas PostgreSQL para incluir agotamiento del pool Prisma y errores de red frecuentes.
- La pantalla de acceso dirige a mantenimiento ante errores de conexión y respuestas de indisponibilidad del servidor.
- Si el API informa que la base aún está en estado `checking` durante el arranque, la pantalla consulta una sola vez más su estado. `/status` usa memoria del proceso y no consulta Neon.
- La pantalla PWA de mantenimiento pasa a ser el primer respaldo de navegación si el sitio web no responde y el Service Worker ya está instalado.
- El botón de reintento ejecuta únicamente `SELECT 1`; no dispara la cola de correos y queda limitado a tres intentos por minuto y por IP.
- Mensajes visibles: disculpa por las molestias y aviso de que se trabaja para restablecer el servicio en las próximas horas.

## Seguridad de datos y despliegue

Este parche no modifica `schema.prisma`, migraciones, tablas, registros ni variables de entorno. No ejecuta `prisma db push`, `migrate` ni `db execute`. No requiere respaldo de datos para el cambio de archivos, aunque se debe conservar la versión anterior del código para rollback.

Hay que actualizar **los dos servicios**: el sitio estático `talento-pyme` y la API `talento-pyme-api`. Desplegar solo uno deja una parte del manejo de mantenimiento sin actualizar.

## Rollback

Si la revisión presenta problemas, restaurar los archivos de v9.1.1 en GitHub y desplegar ambos servicios. No hacer rollback de la base: no se ejecuta ninguna migración.

## Prueba

Prueba automatizada: `npm test -- --test-name-pattern=maintenance-readiness-v912` desde `apps/api` (o ejecutar el test directamente con Node). La revisión no simula una caída real en producción; eso requiere validar en una copia/staging para evitar interrumpir usuarios.
