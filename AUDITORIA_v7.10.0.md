# Auditoría técnica — Talento PyME 7.10.0

## Hallazgos corregidos

| Hallazgo en 7.9.16 | Corrección |
|---|---|
| La palabra «senior» o un cargo gerencial podían elevar la nota a 80/82 sin tareas ni duración | Se eliminó esa escala. Cargo y nivel se separan; la nota depende de evidencia de tareas en la especialidad. |
| Longitud del resumen, texto generado y actividad laboral actual sumaban puntos | No intervienen en el nuevo puntaje. Se deduplican antecedentes. |
| Formación, área deseada y experiencia quedaban mezcladas | Formación sólo orienta. La especialidad requiere cargos o acciones laborales compatibles. |
| El analizador del CV tenía un perfil técnico-industrial senior por defecto | Se reemplazó por clasificación conservadora; sin respaldo, perfil por completar. |
| La redacción local completaba diez fortalezas típicas del oficio | Se conservan expresiones respaldadas; no se obliga a completar diez. Se modificó también el pedido a IA. |
| Presentaciones ampliadas se reutilizaban como prueba de competencia | Se excluyen de clasificación y del índice profesional. No se eliminan textos históricos del candidato. |
| Años acumulados en cualquier rubro podían elevar otro oficio | Se separan años laborales totales y años detectados en la especialidad. Se unen períodos solapados sin duplicarlos. |
| La búsqueda empresarial no compartía la clasificación administrativa | Ambos circuitos llaman al mismo clasificador y construyen su índice con el perfil propuesto y los antecedentes. |
| Datos libres del CV se mostraban en resultados antes de abrir la ficha | Se retiran textos libres de la respuesta resumida. El detalle sigue sujeto a los permisos y capacidad de apertura existentes. |
| Ficha larga y repetitiva | Primera vista breve; fuentes originales y gestión de cuenta bajo desplegable. |
| `Number(null)` podía presentar cero años de experiencia | Se agregaron verificaciones explícitas de ausencia. |
| El ingreso no resolvía DNI directamente | Ruta de identificación exacta por DNI, incluido formato con puntos; ambigüedad rechazada. |
| Búsqueda aproximada limitada a 200 perfiles recientes | Fallback ampliado a 5.000 cuentas, con ambigüedad y clave estricta; acceso por DNI/correo no depende de ese límite. |
| Sin límite local de intentos en ingreso | Límite de 20 solicitudes por IP cada 15 minutos; recuperación inicial incluida. Proxy de Render reconocido sólo en ese entorno. |
| CV guardado con todos los saltos de línea eliminados | Nuevas extracciones conservan separación de experiencia, formación y observaciones. |

## Criterio de clasificación

1. Se leen último trabajo, experiencia del CV y relato original que describe acciones laborales. Se excluyen frases de aspiración, negación y formación del conjunto de experiencia.
2. Se prioriza el último trabajo declarado frente a antecedentes históricos; los históricos respaldados siguen disponibles para búsqueda.
3. Se identifica oficio mediante cargos y tareas. En ausencia de coincidencia suficiente, no se inventa una especialidad dinámica a partir del área elegida.
4. Supervisión/gerencia requieren tanto cargo como responsabilidad descrita. Ser ayudante/auxiliar no acredita autonomía.
5. Sin evidencia: sin puntaje. Primer empleo explícito: 10/100. Cargo o tarea: base 20/30. Con tareas y duración relevante: 25, 45 o 60 según años. Un nivel 75 requiere además múltiples evidencias y responsabilidades. Es una regla operativa provisional, sin validación predictiva de desempeño.
6. Todas las clasificaciones son declarativas, revisables y no verificadas externamente. No se asigna confianza alta automática. Ni edad, DNI, estado civil, sexo, nacionalidad ni foto determinan especialidad, puntuación u orden de resultados.
7. Una fecha válida permite calcular edad. Una edad explícita del CV se distingue como declarada y pendiente de confirmar. No se deduce desde DNI.

## Casos de regresión

- Despachante de supermercado + especialidad elegida instrumentación + resumen IA senior: comercio; no aparece por instrumentista.
- Escuela técnica sin antecedentes: orientación a pasantía técnica; sin oficio acreditado ni puntaje inventado.
- Electricista con tareas: perfil eléctrico encontrable por términos normalizados del perfil.
- Larga experiencia en caja y experiencia eléctrica reciente: los años de comercio no elevan el nivel eléctrico.
- Repetir veinte veces una descripción no aumenta la nota.
- Un curso, aspiración o negación de experiencia no acredita especialidad.
- Ayudante electricista con muchos años: mantiene perfil de asistencia.
- Cambiar fecha de nacimiento, DNI o estado civil no altera clasificación.
- Homónimos o DNI legado duplicado no producen selección arbitraria de cuenta.
- Contraseña aproximada con nombre aproximado: acceso rechazado. Administrador: contraseña estricta.

## Pruebas y límites

Se ejecutaron 203 pruebas sin fallos: la suite anterior ajustada al nuevo comportamiento, 22 casos nuevos de clasificación/datos, 10 de autenticación con bcrypt real y repositorios simulados, y 3 de interfaz/sintaxis. Las verificaciones previas basadas en búsqueda de texto en el código no equivalen a pruebas integrales del servidor. Se conservaron y ajustaron, y se agregaron pruebas funcionales para el comportamiento nuevo.

Prisma validate y generate: correctos. Dependencias resueltas en package-lock.json. npm audit: sin avisos conocidos al ejecutar en este entorno; no garantiza ausencia de vulnerabilidades. Multer actualizado a rama 2, manteniendo memoria, límite de tamaño y formatos soportados.

No hay acceso a los registros reales, por lo que no se midieron falsos positivos/negativos del padrón. No se ejecutaron operaciones en producción ni envíos. Pendientes: prueba real del despliegue, migración contra una copia de la base, correo, navegador móvil/escritorio y revisión humana de una muestra representativa por oficio. Intento de Chromium falló por descarga incompleta. HTML generado, escape de contenido y compilación de scripts sí fueron comprobados.

El buscador empresarial sigue devolviendo como máximo 200 coincidencias por consulta; ahora clasifica el padrón antes de filtrar, sin el corte previo de 2.000. El límite local por IP requiere almacenamiento compartido si se opera con múltiples instancias. CV sin secciones, fechas sólo con meses, intervalos incompletos o roles ambiguos pueden requerir completar información. No se reconstruyen automáticamente datos eliminados por versiones anteriores.

## Datos y actualización

Sólo se agregan `CandidateBolsa.fechaNacimiento String?` y `CandidateBolsa.telefonoAdicional String?`. No se borra ni sobrescribe la información profesional histórica para reclasificar. Los análisis se recalculan al consultar. El protocolo de despliegue continúa usando Prisma; no se autoriza pérdida de datos. Restaurar el código anterior es compatible con conservar las dos columnas nuevas.
