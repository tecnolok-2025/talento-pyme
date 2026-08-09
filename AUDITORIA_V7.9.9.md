# Auditoría Talento PyME v7.9.10

## Alcance
Módulo institucional de comunicaciones masivas a candidatos y empresas desde Correo / Consultas.

## Privacidad y seguridad
- Cada correo se envía individualmente; no se exponen destinatarios entre sí.
- El pie de baja se genera por destinatario con token firmado mediante JWT_SECRET. El enlace abre una pantalla de confirmación: cargar el vínculo no ejecuta la baja automáticamente, evitando bajas accidentales por previsualizadores o analizadores de correo.
- La preferencia de baja se guarda en la cuenta y se respeta en futuros envíos informativos.
- La baja no deshabilita recuperación de contraseña ni mensajes operativos indispensables.
- El administrador puede marcar/revertir la preferencia cuando recibe una solicitud por correo.
- No se agregan credenciales nuevas; se reutilizan FACTORY_SUPPORT_EMAIL y GMAIL_APP_PASSWORD.
- Se agregan cabeceras estándar List-Unsubscribe/List-Unsubscribe-Post y no se incluyen rastreadores de apertura ni enlaces de seguimiento.

## Trazabilidad
Se registra un historial agregado por envío con audiencia, asunto, cantidad prevista, enviados, fallidos y excluidos por baja. No se almacena una lista nueva de emails en el historial.

## Base de datos
Cambios aditivos: bulkEmailOptOutAt, bulkEmailOptOutReason y modelo AdminCommunication. `prisma db push` agrega los campos/modelo sin borrar registros existentes.
