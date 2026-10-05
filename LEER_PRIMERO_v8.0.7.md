# LEER PRIMERO · Talento PyME v8.0.7

Esta versión implementa la **bandeja unificada App + Email** aprobada para soporte de candidatos y empresas.

## Qué cambia
- Gmail de Talento PyME se sincroniza de forma directa por IMAP.
- Botón **Sincronizar correo** en Administración y sincronización automática cada 30 minutos.
- Los correos de usuarios registrados entran al mismo Chat operador con origen EMAIL.
- Se usa la misma clasificación **Tema ya cubierto / Consulta nueva** para App y Email.
- Rebotes definitivos y temporales se separan.
- Un rebote definitivo incorpora el email a una lista de supresión y lo excluye de comunicaciones futuras.
- Los rebotes no se incorporan al Chat operador ni a la trazabilidad operativa.

## Despliegue
1. Subir el parche sobre v8.0.6.
2. Commit en GitHub.
3. Desplegar primero `talento-pyme-api`. El `prestart` ejecuta la migración aditiva v8.0.7.
4. Desplegar `talento-pyme`.
5. Abrir Administración → Correo / Consultas y ejecutar **Sincronizar correo**.

No se modifica el motor profesional de candidatos ni su score.
