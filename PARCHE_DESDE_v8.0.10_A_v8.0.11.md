# Parche v8.0.10 → v8.0.11

Objetivo: corregir búsquedas por título académico/profesional declarado.

Cambio principal: `candidateProfessionalSearchText()` incorpora formación/título declarado como índice de búsqueda y agrega alias morfológicos (por ejemplo, ingeniería → ingeniero/ingeniera/ingeniería).

No altera el motor de clasificación profesional. No requiere migración.
