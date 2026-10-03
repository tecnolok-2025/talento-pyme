# Talento PyME v7.10.15

Revisión correctiva sobre v7.10.14.

## Motivo
La auditoría del resguardo lógico real de v7.10.14 confirmó que el motor 7.10.14 fue aplicado a los 593 candidatos y que la política conservadora de secundarios funciona. Se detectó un caso residual verificable: el cargo **Peón de Cocina** no estaba incluido en el vocabulario de cargos gastronómicos y podía ser desplazado por evidencia comercial anterior.

## Cambio
- Se incorporan `Peón de Cocina` y `Operario/a de Cocina` como cargos gastronómicos explícitos.
- Se mantiene la prioridad temporal de actividad actual/reciente.
- Se mantiene el criterio conservador de secundarios: antecedentes no buscables salvo evidencia complementaria vigente y fuerte.
- Se sincronizan README, CURRENT_VERSION, frontend, API y Service Worker en 7.10.15.

## Base de datos
No requiere migración. El cambio de `CANDIDATE_CLASSIFICATION_VERSION` fuerza la reclasificación automática de los candidatos existentes.
