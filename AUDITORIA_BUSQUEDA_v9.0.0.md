# Auditoría de búsqueda profesional · Talento PyME v9.0.0

Base analizada: respaldo lógico del 06/10/2026. Se analizaron 600 candidatos y sus fuentes profesionales disponibles. El respaldo no se incorpora al release.

## Hallazgo principal

El buscador de v8.0.10 dependía en gran medida de `classification.searchText` y de la etiqueta propuesta. Eso dejaba fuera información profesional real presente en observaciones, experiencia, formación, certificaciones y campos específicos del candidato.

Sobre evidencia declarada/CV, la auditoría encontró ejemplos de pérdida de alcance relevantes. Entre las familias con mayor diferencia entre evidencia fuente e índice anterior estuvieron: técnico, mantenimiento, automatización, administración, logística, producción, calidad, finanzas, RR.HH., HSE, electricidad, proyectos, química, compras, montaje, conducción, ingeniería, ambiente, soldadura, electromecánica, CAD/BIM y COMEX.

Ejemplo de magnitud sobre el respaldo: se detectaron 30 perfiles con evidencia textual explícita de ingeniería; el índice previo sólo recogía una parte de ellos. El problema no era exclusivo de “ingeniero”, sino estructural.

## Criterio v9.0.0

1. La búsqueda incorpora fuentes profesionales declaradas: área, especialidad, último trabajo, observaciones, relato original, herramientas, instrumentación, experiencia, formación, certificaciones y observaciones del CV.
2. Se agregan equivalencias controladas para familias profesionales frecuentes, incluyendo ingeniería, técnica, eléctrica, electromecánica, mecánica, automatización, instrumentación, mantenimiento, producción, calidad, HSE, ambiente, logística, COMEX, administración, finanzas, RR.HH., comercial, IT, proyectos, CAD/BIM, soldadura, montaje, construcción, química, limpieza, gastronomía, seguridad privada, cuidados, educación, conducción, refrigeración, compras, planificación, supervisión y gerencia.
3. Las abreviaturas de tres caracteres o menos se comparan como tokens completos. Así `CAD` no coincide accidentalmente con `capacidad`.
4. Las búsquedas de varias palabras exigen que todos los conceptos estén presentes. `ingeniero mecánico` no devuelve un ingeniero químico sólo por compartir “ingeniero”.
5. Las coincidencias se ordenan por fuerza de evidencia profesional: perfil/rol explícito, evidencia declarada/CV, equivalencias y recién después datos de identidad.
6. Los resúmenes generados por IA no se usan como única fuente para crear una coincidencia profesional.
7. El motor de clasificación, score, seniority y expertise no se modifica.

## Control de integridad

El bloque `buildCandidateAdminClassification()` de v8.0.10 y v9.0.0 es idéntico byte por byte. SHA-256: `60a9e56317c914b77398993900c86636e418507d4fe049763f08293d64c57ba0`.

## Observación de calidad de datos

Un buscador no puede recuperar de forma segura una profesión que no esté declarada en ninguna fuente del perfil/CV. La mejora aumenta el aprovechamiento de la información existente, pero no inventa títulos ausentes.
