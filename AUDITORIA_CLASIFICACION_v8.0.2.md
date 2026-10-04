# Auditoría de clasificación — Talento PyME v8.0.2

Base analizada: resguardo lógico v8.0.1 del 03/10/2026.

## Hallazgo principal
El padrón contiene 593 clasificaciones. Dentro de Aprendices, 211 registros están actualmente como `Aprendiz – estudios secundarios no declarados`.

La revisión del resguardo muestra que esos 211 registros no contienen hoy información práctica suficiente para asignar responsablemente una especialidad: 152 no tienen ficha `candidateBolsa`; los restantes 59 no declaran último trabajo ni área/especialidad útil. Los pocos textos existentes son mayormente textos técnicos generados/boilerplate o expresiones generales de deseo de aprender, no saberes concretos.

Por lo tanto, v8.0.2 no inventa una especialidad para esos registros actuales. En cambio incorpora una regla nueva: cuando un perfil de entrada sin formación declarada sí menciona tareas o saberes concretos, se orienta automáticamente como Aprendiz de la actividad correspondiente.

## Orientaciones prácticas nuevas
- cocina / gastronomía
- limpieza / maestranza
- cuidado de personas
- atención al cliente / ventas
- logística / depósito
- construcción / albañilería
- seguridad / vigilancia
- producción / tareas operativas
- eléctrico
- mecánico
- mantenimiento general
- pintura
- jardinería
- costura / textil
- conducción / reparto
- peluquería / estética
- administrativo

Estas orientaciones se incluyen en el índice de búsqueda y en la composición de Trazabilidad.

## Regla de prudencia
Un saber práctico declarado orienta una categoría de **Aprendiz**, pero no se convierte en experiencia profesional certificada. La confianza permanece baja mientras no exista trayectoria laboral verificable.

## Otras mejoras v8.0.2
- Administración y Empresa desplazan automáticamente la pantalla al primer resultado después de Buscar.
- El selector de acceso inicial pasa de `Ingresar` a `Ya tengo cuenta`; el botón de acción sigue siendo `Ingresar`.
- Capacidad operativa calcula el semáforo en relación con candidatos actuales y capacidad segura estimada a partir del peso real de PostgreSQL, con reserva preventiva del 20%.
- El proveedor se detecta desde `DATABASE_URL`; cuando corresponde se identifica como Neon.
