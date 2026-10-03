# Auditoría profunda de precisión de candidatos · v7.10.13

## Base analizada
Resguardo lógico del 03/10/2026: **593 candidatos y 593 clasificaciones**. La totalidad de las clasificaciones persistidas del resguardo correspondía al motor `7.10.3`.

## Hallazgos principales
1. El motor anterior podía elegir una expertise histórica con mayor cantidad de coincidencias aunque el último trabajo declarado correspondiera claramente a otra actividad.
2. El texto de búsqueda incluía todas las familias detectadas en el CV; por eso una actividad antigua podía hacer aparecer un candidato en una búsqueda actual no pertinente.
3. “Comercial / Atención al cliente” estaba sobrerrepresentado porque expresiones genéricas de atención, caja o contacto con público podían competir con oficios más específicos.
4. Mantenimiento, producción, logística y oficios técnicos necesitaban mayor prioridad semántica cuando aparecían en el rol actual.
5. El puntaje anterior podía resultar demasiado afirmativo frente a evidencia parcial.

## Simulación sobre el padrón real
La v7.10.13 recalificó offline los 593 perfiles sin modificar el resguardo. **71 actividades principales cambiaron** respecto de la clasificación guardada y **62 perfiles** presentaron una segunda actividad con evidencia suficiente para ser mostrada como complementaria.

Se verificaron correcciones de patrones como:
- último trabajo de producción que antes aparecía como logística;
- vigilancia actual clasificada anteriormente como administración o mecánica;
- limpieza o mantenimiento actuales clasificados anteriormente como comercial;
- gastronomía actual desplazada por experiencia comercial previa.

## Criterio nuevo
- Primero: actividad actual / último trabajo específico.
- Segundo: cargo vigente fechado en el CV cuando el último trabajo cargado es genérico.
- Tercero: experiencia reciente y demostrada por tareas.
- Cuarto: experiencia histórica sólo como contexto.

La clasificación no usa edad, DNI, nacionalidad, domicilio ni otros atributos personales como sustituto de experiencia.

## Búsqueda
El índice profesional deja de incorporar indiscriminadamente todas las categorías históricas. Se indexa la actividad principal, la evidencia que la sostiene y sólo perfiles complementarios recientes y suficientemente respaldados.

## Validación técnica
Suite completa: **263 pruebas; 262 aprobadas**. La única prueba no ejecutada correctamente en este entorno fue `auth-v7100.test.js` por ausencia local del paquete `bcryptjs`; la dependencia permanece declarada en `package.json` y se instala normalmente en Render.
