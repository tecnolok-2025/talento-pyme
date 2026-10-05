# Talento PyME v8.0.9

Revisión operativa de Correo / Consultas.

## Cambios principales
- La bandeja visible muestra únicamente consultas reales pendientes.
- Rebotes definitivos, temporales, automáticos y consultas ya respondidas dejan de mostrarse en la lista operativa.
- Los rebotes temporales se agrupan por dirección, sin duplicados, en “Correos temporales para reintentar”.
- Cada rebote temporal activo puede reprogramar la última comunicación general enviada a esa cuenta.
- Una vez reprogramado, sale del panel; si vuelve a rebotar temporalmente, reaparece.
- Los rebotes definitivos continúan suprimidos y no pueden reenviarse.
- “Recuperar correo enviado” permite elegir comunicaciones históricas; asunto + cuerpo repetidos se muestran una sola vez.
- El historial visual también evita repeticiones idénticas.

## Base de datos
No requiere migración nueva. Reutiliza InboundMailMessage, EmailSuppression y AdminCommunication existentes.

## Deploy
Subir el parche sobre v8.0.8 y desplegar API y Web.
