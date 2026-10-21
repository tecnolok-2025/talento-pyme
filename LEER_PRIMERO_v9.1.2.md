# Talento PyME v9.1.2 — mantenimiento ante indisponibilidad

La versión v9.1.1 ya contenía una página de mantenimiento. v9.1.2 refuerza su activación para las fallas de Neon/API y evita que el botón de reintento ejecute tareas ajenas a la comprobación.

## Lo que verá el usuario

Si no se puede conectar con el API/base, se abrirá una pantalla de Talento PyME que informa que el sistema está en mantenimiento, pide disculpas y comunica que se trabaja para restablecerlo en las próximas horas. Incluye un botón para comprobar manualmente si volvió el servicio. No hace polling automático a Neon.

## Alcance

El cambio es de código web/API. No toca la base de datos, las migraciones, los candidatos, las empresas, los usuarios, la auditoría ni la configuración existente. No agregar ni modificar `DATABASE_URL`.

## Para publicar

Actualizar en GitHub los archivos enumerados en `ARCHIVOS_MODIFICADOS.txt` y desplegar primero la API `talento-pyme-api` y luego el sitio `talento-pyme`. Verificar en Render que ambos queden Live y que la web muestre `v9.1.2`.

La pantalla depende de que el sitio estático siga accesible o de que el dispositivo ya tenga instalado su Service Worker. Si Render y el sitio web están totalmente caídos en el primer acceso desde un dispositivo sin caché previa, la aplicación no puede entregar una pantalla alojada dentro de ese mismo sitio; para cubrir también ese caso se necesitaría una página externa independiente.
