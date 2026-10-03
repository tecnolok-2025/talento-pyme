# Talento PyME v7.10.14 — LEER PRIMERO

## Objetivo de esta revisión
La v7.10.14 endurece la clasificación de candidatos para reducir falsos positivos en actividad principal y evitar que especialidades secundarias históricas contaminen las búsquedas empresariales.

## Cambios principales
- Prioridad reforzada a actividad actual / último trabajo verificable.
- Los cargos explícitos pesan más que palabras auxiliares o herramientas.
- `software`, `base de datos`, `calibre`, `portería`, `documentación`, `cotizaciones`, `mantenimiento del orden` y expresiones similares ya no crean por sí solas una especialidad profesional.
- Se agregan detecciones más precisas para Calidad, Eléctrica, Producción, Logística y Administración.
- Perfiles secundarios se separan en `COMPLEMENTARIO` y `ANTECEDENTE`.
- Sólo secundarios vigentes y de evidencia fuerte participan del buscador.
- Si la confianza de la clasificación principal es BAJA, ningún secundario se agrega al texto de búsqueda.
- No se modifica el CV original del candidato.

## Base auditada
Simulación de lectura sobre el resguardo lógico del 03/10/2026: 593 candidatos.
Comparación motor 7.10.13 vs 7.10.14:
- 77 actividades principales cambian por reglas más restrictivas y contextuales.
- Candidatos con algún secundario: 62 -> 51.
- Candidatos con secundario habilitado para búsqueda: 58 -> 2.

## Base de datos
No requiere una nueva migración. Usa la estructura agregada en v7.10.13 (`secondaryProfiles`).
El cambio de `CANDIDATE_CLASSIFICATION_VERSION` a `7.10.14` fuerza el recálculo automático de las clasificaciones al desplegar la API.

## Instalación recomendada
Aplicar el parche v7.10.13 -> v7.10.14 sobre una copia de la versión actualmente instalada, subir los archivos al repositorio y desplegar primero la API y luego la web.
