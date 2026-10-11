# Auditoría de Seguridad · Talento PyME v9.1.0 · Etapa 1

Base técnica: Talento PyME v9.0.0 completa.
Objetivo: reforzar seguridad sin alterar la experiencia funcional de candidatos, empresas ni administración.

## Cambios incorporados

1. **CORS restringido**: la API admite el origen oficial definido por `WEB_BASE_URL` y, opcionalmente, orígenes adicionales declarados en `SECURITY_ALLOWED_ORIGINS`. Clientes servidor-a-servidor sin cabecera `Origin` continúan operativos.
2. **Cabeceras defensivas**: se elimina `X-Powered-By` y se agregan `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y HSTS cuando la aplicación opera detrás de HTTPS/Render.
3. **No-cache de superficies sensibles**: autenticación, perfil actual, administración, Factory, bolsa, CV, empleos, comunicaciones y soporte se responden con `Cache-Control: no-store` y `Pragma: no-cache`.
4. **Rate limiting adicional en autenticación**: toda la superficie `/auth` incorpora un límite amplio por IP de 120 solicitudes cada 15 minutos. El login conserva además su límite histórico más estricto de 20 intentos.
5. **Uploads estáticos endurecidos**: se mantiene la funcionalidad existente, pero se deniegan dotfiles y listados de índice.
6. **Cache PWA/versionado**: se actualizan las referencias a v9.1.0 para evitar que navegadores continúen usando recursos anteriores.

## Garantía de no alteración funcional

No se modificaron reglas de negocio ni flujos de usuario. Continúan sin cambios:
- inicio de sesión y token actual;
- registro y recuperación de contraseña;
- perfiles de candidatos y empresas;
- CV y descarga PDF;
- motor de búsqueda profesional v9.0.0;
- clasificación, score, seniority y expertise;
- búsquedas, oportunidades y postulaciones;
- correo, soporte y comunicaciones;
- Factory y administración.

Control de integridad realizado contra v9.0.0:
- `buildCandidateAdminClassification`: idéntico byte por byte.
- `candidateProfessionalSearchText`: idéntico byte por byte.
- `candidateProfessionalSearchScore`: idéntico byte por byte.

## Validaciones realizadas

- `node --check` sobre API, configuración web y Service Worker: OK.
- 7/7 controles específicos de seguridad v9.1.0: OK.
- Comparación de código v9.0.0 → v9.1.0: los cambios de API quedan concentrados en middleware de seguridad y versión; los cambios web son de versión/cache.
- No se agrega migración de Neon ni se altera el esquema Prisma.

## Configuración Render

`WEB_BASE_URL=https://talento-pyme.onrender.com` continúa siendo el origen oficial permitido.

La nueva variable es opcional:

`SECURITY_ALLOWED_ORIGINS=`

Debe dejarse vacía si sólo se usa el dominio oficial. Si en el futuro se agrega otro frontend legítimo, se podrán indicar varios orígenes separados por coma.

## Cambios deliberadamente postergados

Para preservar la experiencia actual, esta etapa **no** modifica:
- token JWT de 30 días ni almacenamiento del token en `localStorage`;
- cookies HttpOnly;
- forma de entrega de fotografías ya utilizada por la aplicación;
- flujo de Factory Admin;
- política CSP del sitio estático.

Estos puntos deben evaluarse en una Etapa 2 porque pueden exigir cambios de sesión, frontend o despliegue y podrían afectar usuarios si se aplican sin transición.

## Conclusión

v9.1.0 es una revisión de endurecimiento de bajo impacto. Aumenta la protección frente a orígenes web no autorizados, abuso automatizado, cacheo de respuestas sensibles y exposición innecesaria de información técnica, manteniendo el comportamiento funcional de v9.0.0.
