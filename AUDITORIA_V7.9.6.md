# Auditoría Talento PyME v7.9.6

## Objetivo
Corregir la duplicación observada entre “Sobre mí” y “Perfil profesional” del CV generado, ampliar la redacción profesional y garantizar que la IA sólo se ejecute por acción explícita del candidato.

## Cambios verificados
- “Sobre mí” se construye como síntesis ejecutiva breve, independiente de la presentación larga.
- “Perfil profesional” utiliza la presentación profesional ampliada y conserva párrafos.
- La IA solicita 2 a 4 párrafos y 160 a 320 palabras cuando el material declarado lo permite, sin inventar antecedentes.
- El candidato puede borrar, corregir, acortar o ampliar la propuesta antes de guardar.
- Guardar no invoca `refineVoicePresentation`; sólo el botón “Corrección IA profesional” procesa el relato.
- Nombre automático: `YYMMDD-HHmm CV-Nombre-Apellido.pdf`.
- No hay cambios de esquema de base de datos.
- Se conservan inferencia de residencia, seniority, administración, trazabilidad, Gmail y seguridad previas.

## Validación
- 90 pruebas Node: 90 aprobadas.
- Archivos JavaScript: sintaxis validada con `node --check`.
- 16 scripts HTML internos: sintaxis validada.
