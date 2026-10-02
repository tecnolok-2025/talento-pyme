# Talento PyME v7.10.11 — LEER PRIMERO

Esta revisión parte de v7.10.10.

## Cambios principales
- Corrige la identificación visible de versión y agrega sincronización contra `/health` de la API para evitar que la interfaz quede mostrando una versión antigua por caché.
- Refuerza el Service Worker para buscar por red los archivos críticos de versión.
- En Correo / Consultas, el botón “último correo” queda separado por padrón: candidatos y empresas.
- Al cambiar de padrón, el botón, el historial, asunto y cuerpo trabajan exclusivamente sobre ese padrón.
- Si todavía no hubo correos a empresas, el sistema lo informa sin mezclar comunicaciones de candidatos.

No requiere migración nueva de base de datos.
