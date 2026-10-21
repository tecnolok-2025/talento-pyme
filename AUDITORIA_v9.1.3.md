# Auditoría puntual · cola de bienvenida · v9.1.3

## Hallazgo en la captura
El selector “Candidatos con consultas pendientes · App + Email” corresponde a preguntas de soporte sin una guía posterior. El código sólo considera mensajes de candidatos en hilos de soporte. No incluye altas recientes ni el estado del correo de bienvenida. Por eso el valor 0 no prueba que no existan candidatos ni que todos hayan recibido la bienvenida.

## Flujo de bienvenida ya existente
Las altas nuevas de candidatos se registran con `welcomeEmailQueuedAt`. Un worker intenta enviar el mensaje, marca `welcomeEmailSentAt` si el servidor SMTP acepta el envío y registra intentos/errores si falla. Ese estado está en la base, pero no tenía una vista administrativa propia.

## Corrección incluida
Se agrega al resumen autenticado de comunicaciones una consulta de sólo lectura para candidatos con bienvenida en cola y sin marca de envío. El panel informa nombre, correo, fecha de alta, fecha de cola, intentos y si el último intento informó error. Presenta hasta 100 registros, en orden de antigüedad.

El panel no envía, no reintenta y no modifica registros. No altera esquemas, migraciones, contraseñas, configuraciones ni los flujos de consulta de soporte. No se ejecutan comandos de base de datos.

## Límite de interpretación
`welcomeEmailSentAt` significa que el proveedor SMTP aceptó el envío, no confirma que el mensaje haya llegado a la bandeja de entrada. Para casos de rebote o filtrado se requiere revisar los avisos de entrega/buzón.

## Verificaciones
- `node --check` del API y del JavaScript inline del panel: correcto.
- Aserciones de fuente: filtro sólo de candidatos en cola/no marcados como enviados; sólo lecturas en el helper; versión sincronizada: correcto.
- ZIP del parche y del proyecto completo: integridad correcta.
- La suite histórica completa no quedó verde en este entorno: varias pruebas antiguas fijan la versión a 8.0.1 y una prueba requiere `bcryptjs`, no instalado en este directorio de trabajo. No se modificaron esas pruebas históricas en este parche.
