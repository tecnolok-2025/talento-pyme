# Auditoría Talento PyME v7.9.8

## Alcance

La v7.9.8 incorpora envío de comunicaciones administrativas por correo desde el Chat operador, reutilizando la identidad institucional de correo ya configurada.

## Funciones incorporadas

1. **Responder en Talento PyME**: conserva el comportamiento de guardar el mensaje dentro del hilo.
2. **Responder + enviar por email**: registra el mensaje dentro del portal y envía el mismo contenido al correo registrado del candidato o empresa.
3. **Reenviar último mensaje informado por email**: recupera exclusivamente el último mensaje con actor `OPERATOR` y lo vuelve a enviar por correo, sin duplicarlo en el hilo.
4. Se muestra el correo destinatario en el panel antes de enviar.
5. Se preservan los párrafos del texto administrativo en el portal y en el cuerpo del email.
6. El correo contiene un acceso directo a Talento PyME y utiliza el remitente configurado mediante `FACTORY_SUPPORT_EMAIL`.
7. Los envíos y reenvíos generan eventos administrativos `SUPPORT_EMAIL_SENT` / `SUPPORT_EMAIL_RESENT` con destinatario enmascarado.
8. Si el envío combinado por Gmail falla, la respuesta ya guardada en Talento PyME no se pierde y el panel permite reintentar con el botón de reenvío.

## Corrección adicional

Se eliminó el marcador interno `__KEEP__` del render del Chat operador. El detalle del hilo muestra nuevamente el contenido real de cada mensaje.

## Seguridad y privacidad

- Endpoints restringidos a roles `ADMIN` y `SUPERADMIN`.
- No se incorporan credenciales al frontend.
- No se hardcodea ninguna cuenta Gmail.
- Se reutilizan `FACTORY_SUPPORT_EMAIL` y `GMAIL_APP_PASSWORD`.
- No se modifica el esquema Prisma.
- Los logs administrativos guardan el destinatario enmascarado, no el correo completo.

## Base de datos

El hash SHA-256 del `schema.prisma` de v7.9.8 coincide exactamente con el de v7.9.7. No hay migraciones ni campos nuevos.

## Validación

- 106 pruebas Node ejecutadas: **106 aprobadas**.
- 31 archivos JavaScript bajo `apps/`: sintaxis validada con `node --check`.
- 16 scripts inline HTML: sintaxis validada.
- API: sintaxis válida.
- Frontend/PWA: versión unificada **7.9.8**.

## Prueba pendiente de producción

La conexión real SMTP depende de las variables y de la red del servicio API en Render. Después del despliegue debe probarse con un candidato real: primero `Responder + enviar por email` y luego `Reenviar último mensaje informado por email`.
