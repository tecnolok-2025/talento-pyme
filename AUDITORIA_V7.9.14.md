# Auditoría Talento PyME v7.9.14

## Alcance
Revisión específica de los nuevos buscadores administrativos en **Perfiles candidatos** y **Perfiles empresas**, sobre la base funcional v7.9.13.

## Implementación validada
- Selector dinámico `candidateDirectoryProfileFilter` con categorías y expertise existentes.
- Selector dinámico `companyDirectoryProfileFilter` con familias y actividades existentes.
- Los selectores se generan desde la clasificación real del padrón y muestran contadores.
- Soportan filtro por categoría/familia completa y por subperfil/actividad específica.
- Las expertise y actividades dinámicas nuevas aparecen automáticamente al regenerarse el directorio.
- Búsqueda candidata ampliada a datos de identidad, residencia, perfil profesional, presentación personal, CV, experiencia, educación, certificaciones, clasificación, expertise y seniority.
- Búsqueda empresa ampliada a identidad, ubicación, descripción, web, categoría/actividad inferida y contenido de búsquedas publicadas.
- Perfil, palabra clave y período se pueden combinar.
- `Limpiar filtros` restablece selector y palabra clave.

## Privacidad y alcance
- Función exclusiva de Administración.
- No se agregaron estos filtros a portales públicos.
- No modifica criterios de descarte: el filtro sólo organiza/encuentra registros.
- No se modifica `schema.prisma`.

## Versión
- Frontend: 7.9.14
- API: 7.9.14
- PWA/cache: 7.9.14
- Build: 20260810_04

## Pruebas
- Node tests: 152/152 aprobadas.
- Archivos JavaScript: sintaxis validada.
- Scripts inline HTML: 17 validados.
- ZIP: integridad verificada; sin errores de compresión.
