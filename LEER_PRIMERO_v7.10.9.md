# Talento PyME v7.10.9 — LEER PRIMERO

Revisión construida sobre **v7.10.8 COMPLETA AUDITADA**.

## Cambios solicitados

1. **Ingreso de candidatos solo por nombre y apellido + contraseña.**
   - Ya no se ofrece DNI ni correo como identificador de acceso del candidato.
   - El nombre tolera mayúsculas/minúsculas, acentos y espacios exteriores mediante la normalización existente.
   - La contraseña conserva su validación de seguridad actual.
2. **Texto de ayuda del acceso actualizado.**
   - “Ingresá tu nombre completo tal como fue registrado. No distingue entre mayúsculas, minúsculas ni acentos.”
3. **Se eliminó de la pantalla pública la explicación del acceso de Administración.**
   - No se exponen alias, claves ni instrucciones de acceso administrativo.
   - El mecanismo administrativo interno existente no fue modificado.
4. **Registro de candidato corregido visualmente.**
   - El campo Nombre y apellido ya no muestra como ejemplo DNI/correo.

## Alcance

No se modificaron perfiles, CV, clasificación, búsquedas, publicaciones, base de datos ni estructura Prisma.
