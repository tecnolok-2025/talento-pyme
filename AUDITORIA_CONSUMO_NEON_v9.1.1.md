# Auditoría de consumo Neon y continuidad — Talento PyME v9.1.1

Fecha: 21 de octubre de 2026  
Base auditada: paquete completo Talento PyME v9.1.0, Word de diagnóstico, capturas/PDF de Neon, Render y GitHub adjuntos.

## Conclusión

El código v9.1.0 consultaba la base cada 10 segundos desde el trabajador automático de correo. Si Gmail estaba configurado, cada ciclo buscaba tareas de bienvenida y comunicaciones aunque no hubiera correos pendientes. Ese ritmo puede impedir que Neon llegue a su suspensión por inactividad de 5 minutos. La base podía permanecer en compute mínimo durante todo el tiempo que la API estuviera activa.

Como referencia, 0,25 CU activos durante 24 horas equivalen a 6 CU-hours por día. El uso observado de 110,03 CU-hours en unas tres semanas equivale a cerca de 5,2 CU-hours por día. La cercanía hace que el polling de correo sea el principal sospechoso del consumo, aunque no demuestra que sea la única causa. El consumo histórico exacto debe confirmarse con los gráficos de compute de Neon y con los eventos/horarios de Render.

## Evidencia del proyecto y las capturas

- `apps/api/package.json` tenía un `prestart` que generaba Prisma Client y ejecutaba seis archivos SQL con `prisma db execute` en cada arranque.
- Render tenía además un Build Command con `prisma db push --accept-data-loss`. Ese comando puede alterar el esquema de producción durante una compilación y no debe seguir configurado.
- El log de eventos de Render muestra fallos de inicio P1001 repetidos cada aproximadamente 4–6 minutos el 21 de octubre. Esto confirma un ciclo de reinicios cuando la API no podía alcanzar Neon; por sí solo no demuestra que ese ciclo haya originado las 110,03 CU-hours.
- Neon figura en `Limit reached`, con 100 CU-hours incluidos y 110,03 consumidos, 62,67 MB de almacenamiento y la branch `production` archivada/inactiva. El tamaño de almacenamiento no explica el límite de compute.
- El endpoint `/health` del código es estático y no consulta Prisma. Puede usarse para el health check de Render sin despertar Neon.
- La API crea un único `PrismaClient`, pero no tiene un cierre explícito de conexiones al recibir `SIGTERM`/`SIGINT`; el parche agrega cierre ordenado.
- El panel de correo del administrador consultaba actualizaciones cada 30 segundos mientras esa pestaña quedaba abierta.
- La sincronización automática de Gmail ocurría cada 30 minutos y además se ejecutaba 15 segundos después de cada arranque.
- El respaldo lógico local se intentaba 15 segundos después de cada inicio. Recorre varias tablas y escribe un JSON en el disco local de Render. Ese archivo no equivale a una copia externa durable; el almacenamiento local puede perderse al reemplazar la instancia. El exportador tampoco incluye todos los modelos de Prisma y en algunos casos representa fallos de lectura como listas vacías. No debe considerarse un respaldo verificado para restauración.
- El clasificador hacía un barrido completo de candidatos al iniciar la API y su revisión estaba configurada por defecto cada 60 segundos, con un barrido completo cada 6 horas.

## Cambios preparados en v9.1.1

- Se elimina el hook `prestart`; `npm start` ya no ejecuta SQL.
- `npm run build` solo ejecuta `prisma generate`; no conecta a Neon ni modifica tablas.
- El build de Render debe quedar como `npm install && npm run build`. Se debe quitar `prisma db push --accept-data-loss`.
- Se conserva el endpoint `/health` sin consultas a la base.
- Se agrega `/status` y una comprobación puntual `/health/recheck` para la pantalla de mantenimiento.
- El trabajador de correo se despierta al registrarse una cuenta o crear una campaña; luego respeta el intervalo de envío. Si queda ocioso, la revisión de respaldo es cada 6 horas, en vez de cada 10 segundos.
- La sincronización automática del buzón pasa a 6 horas y deja de ejecutarse en cada arranque; la sincronización manual desde Administración continúa disponible.
- La revisión de clasificación pasa a 6 horas y el barrido completo a 24 horas. Los cambios recibidos por los endpoints siguen encolándose por evento y la ejecución administrativa manual permanece disponible.
- La revisión del respaldo lógico local pasa a 6 horas y deja de generar un volcado completo en cada arranque.
- La actualización del panel de comunicaciones pasa a 10 minutos mientras la pestaña de correo esté activa.
- Se agrega una pantalla de mantenimiento amable. No consulta la API en bucle: hace una sola comprobación al entrar y consulta la base solo cuando una persona pulsa “Reintentar conexión”.
- Se agregan manejadores de cierre ordenado de Prisma en `SIGTERM` y `SIGINT`.

## Límites de lo que se pudo confirmar

Las capturas ocultan valores de variables secretas y no permiten confirmar los parámetros completos de `DATABASE_URL`, por ejemplo límites de pool o parámetros adicionales. Tampoco prueban las consultas de cada usuario, el volumen real de aperturas del panel de correo ni el horario exacto en que Render mantuvo la API viva. No se afirma que el polling explique por sí solo todo el consumo.

El screenshot de Neon confirma el límite agotado y la branch inactiva. Este parche no reactiva compute en Neon ni restaura el acceso a la base; evita que el código agrave el consumo una vez que la conexión vuelva a estar disponible.

## Protección de datos y reversibilidad

No se cambiaron `prisma/schema.prisma`, los seis archivos de migración, los modelos ni las consultas de exportación. No se incluye ningún comando que borre registros, reconstruya tablas o modifique datos. El parche es de código y configuración de frecuencia. No se ejecutó contra Neon ni Render.

Antes de volver a habilitar escrituras de producción, se mantiene el proceso acordado: recuperar lectura de la base, obtener un respaldo externo completo, verificar conteos/integridad y preparar rollback. El respaldo lógico local existente en el paquete no satisface esa verificación.

## Validaciones

- Las cuatro pruebas de regresión de consumo y mantenimiento pasan.
- Sintaxis Node validada para la API, `auth.js` y el service worker.
- `package.json` y `package-lock.json` están alineados en v9.1.1.
- Las migraciones y el esquema Prisma deben conservar exactamente los mismos bytes que v9.1.0; comprobar al preparar/instalar el paquete.
- La batería histórica completa tiene pruebas que apuntan a versiones anteriores y requiere dependencias instaladas; no se reporta como aprobada por este parche.
