# Talento PyME v7.10.10

Revisión incremental sobre v7.10.9.

## Cambio principal
En **Correo / Consultas > Comunicaciones Talento PyME** se incorpora el botón **Cargar último correo enviado**.

El botón:
- recupera el último correo que efectivamente tuvo envíos para el padrón seleccionado (candidatos o empresas);
- copia **sin modificaciones** el asunto y el cuerpo de esa comunicación;
- deja activada la opción **Enviar sólo a quienes todavía no recibieron esta misma comunicación**;
- informa cuántos destinatarios actuales todavía no lo recibieron o no lo tienen ya programado.

Luego el administrador decide si presiona **Programar comunicación**. No se dispara ningún envío al cargar el correo.

La bienvenida automática existente continúa funcionando por separado y mantiene prioridad dentro de la cola protegida.

## Base de datos
No requiere migración nueva.
