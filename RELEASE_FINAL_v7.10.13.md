# RELEASE FINAL · Talento PyME v7.10.13

## Objetivo
Mejorar la precisión de la clasificación profesional y reducir falsos positivos en búsquedas empresariales.

## Cambios
- Motor de clasificación: `7.10.13`.
- Prioridad real al último trabajo y a la evidencia vigente.
- Resolución de contradicciones entre un último trabajo genérico y un cargo actual fechado en CV.
- Perfiles complementarios con evidencia fuerte; máximo 2.
- Antigüedad remota no contamina búsquedas.
- Ventana de 10 años para mostrar actividad complementaria y de 5 años para hacerla buscable, salvo actividad actual.
- Puntaje conservador con máximo automático 65/100.
- Ficha administrativa más explícita: actividad principal, rol reciente y perfiles complementarios.
- Nueva migración aditiva `20261003_v71013_candidate_precision`.
- Frontend, API, PWA y package alineados en v7.10.13.

## Despliegue
Aplicar el parche sobre v7.10.12 o desplegar la versión completa. El `prestart` ejecuta la migración idempotente y luego el motor recalifica automáticamente los registros cuya versión de clasificación sea anterior.
