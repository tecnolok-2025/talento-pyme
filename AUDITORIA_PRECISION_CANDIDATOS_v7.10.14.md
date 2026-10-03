# Auditoría de precisión de candidatos — v7.10.14

## Criterio aplicado
La clasificación debe responder primero a la actividad profesional actual o más reciente y a tareas concretas. Herramientas, palabras auxiliares y antecedentes antiguos no pueden transformarse automáticamente en expertise.

## Casos de regresión incorporados
- Pasante en Calidad + base de datos de mantenimiento: Calidad, no IT.
- Supervisor de línea de ensamble: Producción, no Logística.
- Oficial de conexiones + software utilizado: Eléctrica, no IT.
- Portería con limpieza institucional: Maestranza, no Vigilancia.
- Calibres de precisión en ensamble: Producción, no Instrumentación.
- Tango/Excel como herramientas administrativas: Administración, no IT.
- Inbound Representative / WMS: Logística.
- Mantenimiento del orden: no genera Mantenimiento técnico.
- Repositor actual + pasantía antigua en mantenimiento: Comercial actual; mantenimiento sólo antecedente.
- Mandataria actual + producción anterior: Administración actual.

## Perfiles secundarios
La v7.10.14 conserva antecedentes útiles para lectura administrativa, pero los diferencia de un perfil complementario vigente. Sólo una especialidad secundaria vigente, con cargo + tareas y confianza suficiente, puede incorporarse a la búsqueda.

## Resultado de simulación sobre 593 candidatos
- Cambios de actividad principal entre motor v7.10.13 y v7.10.14: 77.
- Algún perfil secundario: 62 -> 51.
- Perfil secundario buscable: 58 -> 2.

Estos valores corresponden a una simulación de lectura sobre el resguardo adjunto y no modifican Neon.

## Validación técnica
- 13/13 pruebas específicas v7.10.14 aprobadas.
- Suite general: 272/273 pruebas aprobadas en este entorno.
- La única prueba no ejecutable (`auth-v7100.test.js`) requiere `bcryptjs` instalado localmente; la dependencia continúa declarada en `package.json` y se instala durante `npm install` en Render.
