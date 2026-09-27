# Talento PyME — Auditoría final de preinstalación v7.10.4

Fecha: 27/09/2026
Base de producción actual: v7.9.16
Padrón usado para compatibilidad: 513 candidatos

## Criterio de esta revisión

v7.10.4 no modifica el motor de clasificación de v7.10.3. Se limita a cerrar cinco puntos de preinstalación con criterio conservador.

## 1. Recuperación por correo

**Estado: CONSERVADA.**

- El bloque backend `/auth/password-recovery/start`, `/verify` y `/complete` es byte a byte idéntico al de v7.10.3.
- `forgot.html` es funcionalmente idéntico después de normalizar únicamente el número de versión visible.
- Continúa el flujo: identificación -> código al correo registrado -> validación -> nueva contraseña.
- No se sustituyó bcrypt ni se modificó el mecanismo probado por el usuario.

Limitación del entorno local: la prueba aislada `auth-v7100.test.js` no puede iniciar porque `bcryptjs` no está instalado físicamente en `node_modules`. El paquete sigue declarado en `package.json` y `package-lock.json`.

## 2. Restricción explícita por rol

**Estado: APROBADA.**

Quedan protegidos con `requireRole("CANDIDATE")`:

- GET/PUT `/profile/me`
- POST `/resume/parse`
- GET/PUT `/resume/me`
- GET/POST `/bolsa/me`
- POST/DELETE `/bolsa/photo`

La búsqueda, detalle y funciones de Empresa mantienen `requireRole("COMPANY")`. Administración conserva sus controles propios.

No se encontró uso de esos endpoints propios de candidato desde las pantallas Empresa o Administración, por lo que el endurecimiento no altera flujos legítimos existentes.

## 3. Lectura profesional para Empresa

**Estado: APROBADA A NIVEL API/UI.**

La ficha completa de Empresa incorpora `lectura_profesional` con:

- perfil propuesto;
- nivel estimado;
- experiencia relevante;
- último rol detectado;
- fundamento;
- evidencias principales;
- información a confirmar en entrevista;
- fuentes profesionales consideradas.

No expone `sourceFingerprint`, `classificationVersion`, logs ni metadatos administrativos internos.

La vista `buscar.html` incorpora un bloque visible **Lectura profesional Talento PyME**.

## 4. Migración y rollback

**Estado: APROBADO EN DISEÑO Y COMPATIBILIDAD; PENDIENTE EJECUCIÓN CONTRA STAGING POSTGRESQL.**

Se retira `prisma db push` del prestart de producción. v7.10.4 aplica un SQL aditivo e idempotente con:

- `ADD COLUMN IF NOT EXISTS` para `fechaNacimiento` y `telefonoAdicional`;
- `CREATE TABLE IF NOT EXISTS` para `CandidateClassification`;
- índices `IF NOT EXISTS`;
- FK protegida contra duplicación.

El SQL no contiene DROP, TRUNCATE, RENAME, ALTER COLUMN ni DELETE.

Compatibilidad estructural v7.9.16 -> v7.10.4:

- 77/77 rutas detectadas en v7.9.16 continúan;
- se agregan `/admin/classification/status` y `/admin/classification/run`;
- ningún modelo viejo desaparece;
- ningún campo viejo desaparece;
- no cambia el tipo de ningún campo viejo.

Compatibilidad con el backup de 513:

- 513 candidatos;
- 513 Profile;
- 513 Resume;
- 324 CandidateBolsa;
- 0 violaciones de campos obligatorios en los 324 CandidateBolsa;
- las nuevas columnas son opcionales;
- `CandidateClassification` puede comenzar vacía y poblarse por el scheduler.

Se entrega un ZIP separado de rollback seguro basado en v7.9.16 que elimina únicamente el `prisma db push` automático del prestart. El rollback conserva los objetos nuevos en PostgreSQL y el código antiguo simplemente los ignora.

## 5. Smoke test

**Estado: PARCIALMENTE APROBADO; FALTA E2E REAL EN STAGING.**

Aprobado localmente:

- 231/231 pruebas automatizadas que no dependen de bcrypt instalado;
- 4/4 pruebas nuevas de preinstalación;
- 24/24 archivos/bloques JavaScript frontend sin errores de sintaxis;
- backend principal pasa `node --check`;
- instancia HTTP local de smoke sirvió correctamente las pantallas principales y la nueva lectura profesional Empresa;
- recuperación conserva UI y contrato esperado en el harness.

No se declara aprobado un smoke browser end-to-end real porque:

1. este entorno no tiene las dependencias npm instaladas y no puede resolver npm desde Internet;
2. Chromium disponible en el contenedor no completa ni una página HTML mínima y termina por timeout;
3. no se conectó la candidata a Neon de producción, deliberadamente.

Por lo tanto, el último gate antes de producción debe ejecutarse en una instancia de staging/preview con dependencias reales y una PostgreSQL de prueba/copia: health, login Candidato/Empresa/Administración, recuperación real de correo, búsqueda, apertura de ficha, actualización de CV, scheduler y responsive PC/móvil.

## Integridad del clasificador

El bloque `buildCandidateAdminClassification` es byte a byte idéntico al de v7.10.3. Esta revisión no recalibra ni altera la clasificación de los 513 candidatos.

## Dictamen

v7.10.4 queda como **candidata de despliegue a staging**, no todavía como despliegue directo a producción. No se identificó una incompatibilidad estructural con v7.9.16 ni con el backup actual de 513 candidatos. El único gate pendiente es la ejecución end-to-end real en una instancia con runtime completo.
