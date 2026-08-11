# Auditoría Talento PyME v7.9.15

## Alcance
Revisión integral del criterio de clasificación y seniority candidato sobre la base v7.9.14.

## Criterio funcional
- El sistema analiza CV, fechas, cargos, tareas, responsabilidades, Presentación Personal, perfil declarado, formación y certificaciones.
- La ausencia de una antigüedad explícita no equivale a experiencia baja.
- “Aprendiz / Pasante / Primer empleo” requiere una señal explícita del propio material profesional y ausencia de antecedentes contradictorios.
- Cuando no existe evidencia suficiente para estimar seniority, se informa “Trayectoria no determinada” e índice N/D.
- Un rango 0–1 puede ser descartado como techo si el resto de los antecedentes demuestra múltiples roles, supervisión, conducción o trayectoria desarrollada.
- Los antecedentes laborales fechados continúan teniendo máxima prioridad para reconstruir años reales.
- Expertise continúa analizándose sobre el CV completo y la actividad/rol reciente.

## Salvaguardas
- No se usa edad, fecha de nacimiento, foto, nacionalidad, estado civil, hijos, domicilio ni salario para inferir experiencia o seniority.
- El indicador es administrativo/orientativo y no constituye recomendación automática de contratación ni descarte.
- No se modifica la base de datos ni `schema.prisma`.

## Transparencia administrativa
Se muestran nivel estimado, índice o N/D, años detectados, fuente principal, fuentes analizadas, confianza, evidencia profesional y base del indicador.

## Versión
- Frontend: 7.9.15
- API: 7.9.15
- PWA/cache: 7.9.15
- Build: 20260811_01

## Pruebas finales
- Node tests: 162/162 aprobadas.
- JavaScript: 38 archivos validados con `node --check`.
- Scripts inline HTML: 17 validados.
- Sin cambios de schema Prisma respecto de v7.9.14.
