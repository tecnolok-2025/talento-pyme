# Talento PyME — v7.8.13

Proyecto gratuito (cero costos) pensado como **Web + PWA instalable** (sin App Store / Play Store) + **API Node** + **PostgreSQL (Neon)**.

## Estado actual
- **Frontend (Static Site Render):** https://talento-pyme.onrender.com
- **API (Web Service Render):** https://talento-pyme-api.onrender.com
- **DB:** Neon (PostgreSQL) via Prisma.

## Accesos (sin confusión)
El portal conserva **3 maneras de ingreso**:
- **CANDIDATE (Candidato)**
- **COMPANY (Empresa)**
- **ADMIN / SUPERADMIN (Administración)**

> Candidato y empresa conservan sus funciones y visibilidad diferenciadas. Administración concentra la vista general, los perfiles completos, la trazabilidad, Factory Admin, la capacidad operativa y el chat operador.

> Importante: el PDF que venías adjuntando es una **exportación** (foto en el tiempo). Para que el PDF “muestre” la nueva versión, hay que volver a exportarlo. El origen de la versión es este README + la versión que muestra la app.

## Acceso (registro / ingreso)
- **Registro (primera vez):**
  - Candidato: Nombre y apellido, Email, DNI, Dirección, Localidad, Teléfono, Contraseña
  - Empresa: Contacto (Nombre y apellido), Empresa, CUIT, Email, Dirección, Localidad, Teléfono, Contraseña
- **Ingreso:**
  - Empresa: ingresa con **nombre de la empresa** + contraseña
  - Candidato: ingresa con **nombre y apellido** + contraseña
- **Recupero de contraseña:** DNI (candidato) o CUIT (empresa) sólo identifican la cuenta; el cambio de clave exige validar un código temporal enviado al correo registrado.


## Correo institucional único
- Talento PyME utiliza **una sola casilla institucional** para soporte, consultas, envío de códigos de recuperación y lectura del buzón desde Administración.
- La dirección institucional se toma exclusivamente de la variable existente `FACTORY_SUPPORT_EMAIL`.
- En la instalación actual esa variable corresponde a `talentopyme00@gmail.com`.
- Factory, Ayuda IA, recuperación de contraseñas y `Correo / Consultas` usan siempre esa misma dirección.
- No debe crearse ninguna segunda variable de identidad de correo.
- Para que Render pueda enviar y leer Gmail, Google exige además autorización de la cuenta mediante OAuth 2.0 o contraseña de aplicación; esas credenciales se guardan sólo en Render y no cambian la dirección institucional.

## PWA / caché
La PWA usa Service Worker con caché versionada (por ejemplo `tp-cache-4.3.0`) y un botón en Acceso **“Actualizar versión”** para forzar refresh.


## Versión única (anti-confusión)
- UI: `apps/web/config.js` → `TP_APP_VERSION = "7.8.13"`
- API: `apps/api/package.json` → `7.8.13` y endpoint `/health`.

## Administración de candidatos y empresas
- El contador administrativo toma todas las cuentas registradas como candidato, incluso si todavía no completaron el CV laboral.
- La pestaña **Perfiles candidatos** permite buscar por nombre, DNI o mail y abrir/cerrar cada ficha individual.
- La ficha del candidato muestra datos personales, perfil profesional, experiencia, formación, herramientas, resumen extraído del CV, observaciones, postulaciones y datos de acceso.
- La nueva pestaña **Perfiles empresas** permite buscar por empresa, contacto, CUIT o mail y abrir una ficha institucional/operativa completa.
- La ficha de empresa muestra identidad, contacto, resumen institucional, búsquedas, actividad comercial/Factory y soporte.
- Desde ambas fichas, Administración puede **enviar una recuperación segura por correo**; Administración no puede ver ni asignar contraseñas directamente.
- Cada candidato mantiene **Mantener indefinidamente** activado por defecto, con persistencia individual en la base.
- `npm start` aplica el ajuste de esquema requerido antes de iniciar la API, sin borrar los registros existentes.


## Resguardo y capacidad operativa
- Panel de superadministración con semáforo de capacidad DB.
- Política visible de backup: automático diario, conservando los últimos 2 días, con respaldo externo del proveedor.
- Botón específico para **Ampliar capacidad DB** mediante URL configurable (`ADMIN_UPGRADE_URL`).
- Tabla histórica `AdminMonthlySnapshot` para consolidación mensual de trazabilidad.

> Importante: el tablero muestra y documenta la política de resguardo. La ejecución real del backup externo depende de que el proveedor/hosting tenga esa rutina activada en su consola.

- Protección anti-regresión del backup: si el resguardo nuevo cae bruscamente en peso o cantidad de registros frente al último backup confiable, el sistema lo bloquea y conserva la referencia anterior.
- Validación adicional para abrir **Ampliar capacidad DB** desde superadministración con clave personal de la sesión.
