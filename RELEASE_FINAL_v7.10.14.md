# Release Final — Talento PyME v7.10.14

Estado: lista para desplegar sobre v7.10.13.

### Cambios funcionales
- Motor de clasificación 7.10.14.
- Menos falsos positivos por palabras de contexto.
- Mayor prioridad de cargo actual/reciente.
- Separación de especialidad complementaria vs antecedente.
- Secundarios de baja confianza fuera del buscador.
- Etiquetas administrativas actualizadas para mostrar si un secundario es `buscable` o `antecedente`.

### Persistencia
No requiere nueva migración. El cambio de versión del motor provoca reclasificación automática de candidatos existentes.

### Versionado
Frontend, API, Service Worker y package version quedan en v7.10.14.
