# Talento PyME v9.1.3

## Cambio
Se agrega al panel de Comunicaciones una vista de sólo lectura para candidatos cuyo correo de bienvenida figura en cola y todavía no consta como enviado. Muestra antigüedad, cantidad de intentos y si el último intento tuvo error. No dispara envíos ni reintentos.

## Seguridad de datos
- No modifica ni elimina registros.
- No cambia esquema, migraciones, variables ni credenciales.
- No ejecuta comandos Prisma de escritura.
- La lista está protegida por la autenticación ADMIN/SUPERADMIN del resumen de comunicaciones.
- El endpoint devuelve como máximo 100 filas pendientes en orden FIFO, más un indicador si hay más.

## Instalación
La publicación requiere actualizar el API y el sitio web desde el mismo commit. No ejecutar migraciones ni `prisma db push`. Conservar la versión anterior para rollback.

## Importante
La vista “Candidatos con consultas pendientes · App + Email” continúa representando consultas de soporte sin responder. Las bienvenidas pendientes aparecen en el panel separado y no se mezclan con una comunicación general, para evitar enviar un mensaje equivocado o duplicado.
