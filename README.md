# Talento PyME — v3.2.7

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

## Acceso (registro / ingreso)
- **Registro (primera vez):**
  - Candidato: Nombre y apellido, Email, DNI, Dirección, Localidad, Teléfono, Contraseña
  - Empresa: Contacto (Nombre y apellido), Empresa, CUIT, Email, Dirección, Localidad, Teléfono, Contraseña
- **Ingreso:**
  - Empresa: ingresa con **nombre de la empresa** + contraseña
  - Candidato: ingresa con **nombre y apellido** + contraseña
- **Recupero de contraseña:** valida contra los datos de registro (DNI/CUIT, según corresponda).

## PWA / caché
La PWA usa Service Worker con caché versionada (`tp-v3.2.6`) y un botón en Acceso **“Actualizar versión”** para forzar refresh.
