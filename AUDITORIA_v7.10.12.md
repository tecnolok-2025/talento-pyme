# Auditoría técnica Talento PyME v7.10.12

## Hallazgos confirmados
1. **Versión operativa:** v7.10.11 estaba correctamente visible en la aplicación, pero `README.md` seguía encabezado como v7.10.8. Eso explica parte de la confusión al mirar GitHub.
2. **Documentación histórica en raíz:** GitHub muestra decenas de auditorías y releases viejos. No son versiones activas; son archivos históricos.
3. **Feedback de botones insuficiente:** la clase base `.btn` tenía cursor y formato, pero no un estado `:active` transversal ni un bloqueo general de repetición.
4. **Riesgo de doble acción:** varios handlers asíncronos dependían de que cada pantalla deshabilitara manualmente el botón. Se incorporó una protección común para clics rápidos repetidos y estado ocupado en acciones críticas.
5. **Borrado de búsquedas:** el endpoint hacía `prisma.job.delete()` aun cuando existían `Application`, provocando la restricción `Application_jobId_fkey`. Se corrige cerrando la búsqueda y preservando postulaciones cuando ya tiene historial.

## Criterio aplicado
- El usuario debe percibir inmediatamente que un botón fue presionado.
- Una acción crítica no debe poder dispararse dos o tres veces por clics reiterados.
- La trazabilidad histórica no debe perderse para resolver un borrado.
- Una sola versión operativa debe quedar identificada por archivos runtime y por documentación de cabecera.

## Riesgos que permanecen controlados
- Los archivos históricos seguirán visibles en GitHub hasta archivarlos o eliminarlos de la raíz.
- El bloqueo global de repetición está orientado a clics accidentales rápidos; las acciones críticas mantienen además su propio bloqueo hasta finalizar.

## Validación automatizada
- Suite ejecutada: **256 pruebas**.
- Resultado: **255 aprobadas**.
- 1 prueba (`auth-v7100.test.js`) no pudo ejecutarse en este entorno porque no está materializado `node_modules/bcryptjs`; `bcryptjs` continúa declarado en `package.json` y `package-lock.json`.
- Las pruebas específicas nuevas de feedback táctil, prevención de repetición, bloqueo de comunicación y cierre seguro de búsquedas aprobaron correctamente.

## Revisión de sintaxis
- `apps/web/auth.js`: OK.
- `apps/web/bolsa-candidato.js`: OK.
- `apps/api/src/index.js`: OK.
