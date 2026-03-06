# Talento PyME — v4.0.7

Proyecto gratuito (cero costos) pensado como **Web + PWA instalable** (sin App Store / Play Store) + **API Node** + **PostgreSQL (Neon)**.

## Estado actual
- **Frontend (Static Site Render):** https://talento-pyme.onrender.com
- **API (Web Service Render):** https://talento-pyme-api.onrender.com
- **DB:** Neon (PostgreSQL) via Prisma.

## Roles (sin confusión)
Solo existen **2 perfiles**:
- **CANDIDATE (Candidato)**
- **COMPANY (Empresa)**

> En el panel de acceso ya **no** existen Admins/Superadmin.

> Importante: el PDF que venías adjuntando es una **exportación** (foto en el tiempo). Para que el PDF “muestre” la nueva versión, hay que volver a exportarlo. El origen de la versión es este README + la versión que muestra la app.

## Acceso (registro / ingreso)
- **Registro (primera vez):**
  - Candidato: Nombre y apellido, Email, DNI, Dirección, Localidad, Teléfono, Contraseña
  - Empresa: Contacto (Nombre y apellido), Empresa, CUIT, Email, Dirección, Localidad, Teléfono, Contraseña
- **Ingreso:**
  - Empresa: ingresa con **nombre de la empresa** + contraseña
  - Candidato: ingresa con **nombre y apellido** + contraseña
- **Recupero de contraseña:** valida contra los datos de registro (DNI/CUIT, según corresponda).

## PWA / caché
La PWA usa Service Worker con caché versionada (por ejemplo `tp-cache-4.0.6`) y un botón en Acceso **“Actualizar versión”** para forzar refresh.


## Versión única (anti-confusión)
- UI: `apps/web/config.js` → `TP_APP_VERSION = "4.0.6"`
- API: `apps/api/package.json` → `4.0.6` y endpoint `/health`.
