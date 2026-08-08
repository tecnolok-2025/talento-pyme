# Talento PyME v7.8.13 · Correo institucional único

## Criterio definitivo

Talento PyME usa **una sola dirección institucional** y reutiliza la variable que ya existe en Render:

- `FACTORY_SUPPORT_EMAIL=talentopyme00@gmail.com`

No debe crearse ninguna otra variable de dirección institucional. Factory, Ayuda IA, recuperación de contraseñas y Administración → Correo / Consultas toman siempre `FACTORY_SUPPORT_EMAIL`.

## Importante: dirección ≠ autorización de Gmail

La dirección ya configurada alcanza para identificar la casilla y mostrarla en el sistema, pero Google no permite que un servidor envíe correos o lea la bandeja de entrada sólo con la dirección. Para esas funciones hay que autorizar **esa misma cuenta** en Render. No se crea otro correo.

La API acepta una de estas dos formas de autorización:

### Opción simple · contraseña de aplicación
- `GMAIL_APP_PASSWORD` = contraseña de aplicación de Google para `talentopyme00@gmail.com`.

### Opción OAuth 2.0
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

Las credenciales se guardan exclusivamente en las variables secretas del servicio API de Render. Nunca deben escribirse en el ZIP ni enviarse dentro del portal.

## Funciones que usan la misma casilla

1. Correo institucional visible en Factory y soporte.
2. Remitente de los códigos temporales de recuperación de contraseña.
3. Bandeja Administración → Correo / Consultas.
4. Consultas y ayuda institucional.

## Recuperación de contraseña

- Candidato: DNI → código al correo personal registrado → validación → nueva contraseña.
- Empresa: CUIT → código al correo registrado → validación → nueva contraseña.
- `FACTORY_SUPPORT_EMAIL` funciona como remitente institucional.

## Despliegue

No hay que cambiar `FACTORY_SUPPORT_EMAIL` si ya contiene `talentopyme00@gmail.com`. Desplegar la v7.8.13 normalmente. Si todavía no existe autorización Gmail, el resto de la aplicación funcionará pero las funciones automáticas de envío/lectura informarán que falta autorizar Gmail.
