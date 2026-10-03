# Parche v7.10.13 -> v7.10.14

## Qué hace
Actualiza el motor de clasificación de candidatos y unifica la versión visible del frontend/API/PWA en 7.10.14.

## No hace
- No borra candidatos.
- No reescribe CV.
- No elimina historial.
- No requiere `prisma db push`.
- No requiere nueva migración de Neon.

## Despliegue
1. Extraer el ZIP del parche sobre una copia local de la v7.10.13 y aceptar reemplazo de archivos.
2. Subir los archivos resultantes al repositorio `tecnolok-2025/talento-pyme` conservando las carpetas.
3. Confirmar el commit.
4. En Render, desplegar `talento-pyme-api` desde el último commit.
5. Verificar en logs: `Clasificación automática activa · motor 7.10.14`.
6. Esperar el barrido automático. El worker comienza después del arranque y procesa por lotes.
7. Desplegar/confirmar el Static Site `talento-pyme` desde el mismo commit.
8. Abrir la web con recarga completa (Ctrl+F5) y verificar v7.10.14.

## Verificación administrativa
En Administración, revisar el estado del motor y una muestra de candidatos críticos. Los antecedentes no buscables pueden verse en la ficha, pero no deben participar de las búsquedas empresariales.
