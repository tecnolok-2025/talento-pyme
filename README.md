# Talento PyME — v3.0.0

## Qué incluye (v3)
- Web + PWA instalable (sin tiendas) y API Node + Prisma + Neon
- Roles:
  - CANDIDATE (Candidato)
  - COMPANY (Empresa)
  - ADMIN_CANDIDATE (Admin Candidatos) *requiere código*
  - ADMIN_COMPANY (Admin Empresas) *requiere código*
  - SUPERADMIN (Superadmin) *requiere código*
  - (legacy) ADMIN
- Candidato:
  - Mi Perfil (incluye Sector/Subsector)
  - Mi CV con “Leer y completar” (parseo de PDF/DOCX/TXT vía /resume/parse)
- Empresa:
  - Mi Empresa
  - Publicar empleos
  - Mis Búsquedas
- Rubro “Hotelería” con subrubros
- Panel Superadmin con métricas básicas (usuarios/candidatos/empresas/CVs/empleos/postulaciones)

## Nota sobre actualizaciones de la PWA
La PWA usa Service Worker con caché versionada. En v3 el caché pasa a `tp-v3.0.0` para forzar actualización en iPhone/Android al recargar (y evitar quedarse pegado a una versión vieja).

