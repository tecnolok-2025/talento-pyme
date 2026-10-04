# LEER PRIMERO — Talento PyME v8.0.6

Esta revisión parte de v8.0.5.

## Qué corrige
1. Corrige el semáforo del perfil: **Perfil laboral** se completa con Área + Especialidad. **Experiencia y formación** queda como indicador separado.
2. Agrega auditoría de altas de candidatos durante las últimas 72 horas: intentos, altas completadas, rechazos y errores de conexión.
3. Agrega **Verificar alta de candidatos** en Administración. La prueba valida lectura/escritura de PostgreSQL sin crear candidatos ficticios.
4. La auditoría no almacena contraseña, DNI, email ni teléfono.

## Importante
Esta versión incorpora una migración aditiva e idempotente para crear la tabla `RegistrationAuditEvent`. El `prestart` la ejecuta automáticamente.
