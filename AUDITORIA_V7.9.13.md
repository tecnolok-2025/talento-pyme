# Auditoría Talento PyME v7.9.13

## Objetivo
Corregir clasificaciones de candidatos que podían quedar artificialmente bajas cuando el formulario tenía poca información pero existía un CV o antecedentes curriculares con una trayectoria extensa.

## Hallazgo
La v7.9.12 ya consultaba `resume.summary` y `resume.experience`, pero el CV tenía un peso insuficiente en el índice 0–100 cuando no existía una frase explícita como “30 años de experiencia”. Un rango básico mal cargado podía dominar sobre años de trayectoria deducibles de las fechas laborales del CV.

## Corrección aplicada
- Lectura integral de perfil, presentación personal, CV, experiencia, educación, certificaciones y observaciones.
- Detección de años de experiencia explícitos en voz/texto y CV.
- Estimación cronológica desde períodos laborales del CV, incluyendo rangos `YYYY-YYYY`, `YYYY-Actualidad` y `MM/YY-MM/YY`.
- Los períodos se fusionan para evitar sumar dos veces etapas superpuestas.
- La evidencia de CV puede corregir un rango de experiencia inicial o incorrecto cargado en el formulario.
- Las palabras “junior”, “aprendiz” o “pasante” no reducen una trayectoria respaldada por CV.
- Las funciones de supervisión, jefatura, gerencia y profesionales se buscan también en antecedentes curriculares cuando el CV contiene evidencia suficiente.
- Expertise: rol actual/reciente conserva prioridad, pero el CV reciente y el CV completo participan con peso significativo.
- La clasificación no queda almacenada como una nota fija: se recalcula al construir los directorios y al abrir el detalle administrativo.

## Transparencia administrativa
La ficha muestra ahora:
- Nivel estimado.
- Índice de trayectoria.
- Años de experiencia detectados.
- Fuente principal de experiencia.
- Fuentes profesionales analizadas.
- Base del indicador y criterio de clasificación.

## Privacidad
El índice sigue sin usar edad, fotografía, género, nacionalidad, estado civil, hijos, dirección, salario pretendido ni atributos personales sensibles.

## Base de datos
`schema.prisma` es idéntico al de v7.9.12. No se requiere migración nueva y no se modifican registros existentes.

## Validación
- 142 pruebas Node: 142 aprobadas.
- 36 archivos JavaScript: sintaxis correcta.
- 17 scripts inline HTML: sintaxis correcta.
- Test específico: CV con trayectoria 1993–Actualidad corrige un rango 0–1 y queda Senior.
- Test específico: CV completo puede definir expertise sin ignorar la actividad reciente.
