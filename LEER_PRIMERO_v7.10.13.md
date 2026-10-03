# LEER PRIMERO · Talento PyME v7.10.13

Esta revisión está centrada en el corazón operativo de Talento PyME: **la precisión del candidato**.

## Qué cambia
- La **actividad actual o último trabajo** pasa a tener prioridad real sobre actividades antiguas.
- Si el campo “Último trabajo” es demasiado genérico pero el CV declara un **cargo actual fechado y con tareas concretas**, prevalece la evidencia actual más precisa.
- Una experiencia antigua no relacionada deja de contaminar la búsqueda por palabra clave.
- Se incorporan **perfiles complementarios** sólo cuando hay evidencia fuerte y suficientemente reciente.
- Experiencias de más de 10 años pueden conservarse como antecedente, pero no se presentan como expertise alternativo.
- Para búsquedas, un perfil complementario histórico sólo es indexable si tiene evidencia de los últimos 5 años o corresponde a la actividad actual.
- El indicador de expertise se vuelve deliberadamente **más conservador**; el máximo automático se limita a 65/100.
- La ficha administrativa muestra actividad principal, rol reciente, perfiles complementarios, evidencia y confianza.

## Recalificación
El motor de clasificación cambia de `7.10.3` a `7.10.13`. Por diferencia de versión, el barrido automático del servidor recalifica el padrón al iniciar, sin modificar el CV fuente del candidato.

## Base de datos
Se agrega únicamente el campo JSON opcional `secondaryProfiles` a `CandidateClassification`. La migración es aditiva e idempotente.
