# Auditoría de clasificación administrativa — Talento PyME v7.8.15

## Alcance
Revisión de la nueva organización de Perfiles candidatos y Perfiles empresas sobre la base funcional v7.8.14.

## Empresas
- Tres categorías operativas solicitadas: Fabricación, Logística y Servicio.
- Clasificación automática conservadora basada en nombre, resumen institucional, sitio y búsquedas laborales.
- Cuando la evidencia es insuficiente no se fuerza una categoría: se muestra Pendiente de clasificar.
- Administración puede guardar una corrección manual, persistida en `CompanyProfile.adminCategory`.
- Los contadores se calculan sobre todo el padrón que cumple los filtros administrativos, no sólo sobre la página visible.

## Candidatos
- Clasificación primaria por seniority/tipo de perfil.
- Clasificación secundaria por expertise.
- Se priorizan nivel, área y especialidad; se utiliza CV/resumen como respaldo para perfiles incompletos.
- Los grupos vacíos no se renderizan.

## Seguridad / visibilidad
- Todo el sistema de clasificación está detrás de endpoints ADMIN/SUPERADMIN.
- No se agregaron campos ni contadores a pantallas públicas de candidato o empresa.
- Se conserva el mecanismo de recuperación segura por correo y el resto de v7.8.14.

## Base de datos
- Se agrega únicamente `CompanyProfile.adminCategory String?`.
- Es nullable y no requiere backfill destructivo.
- `npm start` ejecuta `prisma db push` antes de iniciar la API.

## Validación
- Sintaxis API: correcta.
- Sintaxis del script inline de Administración: correcta.
- Pruebas Node: 44/44 aprobadas.
