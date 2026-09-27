# LEER PRIMERO — Talento PyME v7.10.4

## Qué cambia respecto de v7.10.3

1. **Recuperación de contraseña:** no se modifica funcionalmente. Se conserva el flujo ya probado de identificación, código enviado al correo registrado, validación y nueva contraseña.
2. **Roles:** Profile, Resume y Bolsa propios quedan protegidos explícitamente con rol `CANDIDATE`.
3. **Empresa:** la ficha completa incorpora una lectura profesional ampliada: perfil, nivel estimado, experiencia relevante, último rol detectado, fundamento, evidencias y puntos a confirmar en entrevista. No se exponen fingerprint, versión interna del motor ni metadatos administrativos.
4. **Base de datos:** se elimina `prisma db push` del prestart de producción. La ampliación se aplica con SQL aditivo e idempotente.
5. **Rollback:** se entrega un paquete v7.9.16 de rollback seguro que no intenta achicar el esquema.

## Qué NO cambia

- No cambia el motor de clasificación calibrado en v7.10.3.
- No cambia la clasificación de los 513 candidatos por estas correcciones.
- No se modifica Neon durante la preparación local.
- No se cambia el flujo funcional de recuperación por correo.
- No se borran ni renombran columnas o tablas existentes.

## Estado de pruebas locales

- Recuperación: bloque backend idéntico al de v7.10.3.
- Clasificador: bloque `buildCandidateAdminClassification` idéntico al de v7.10.3.
- Suite no-auth: 231/231 aprobada.
- Pruebas nuevas de preinstalación: 4/4 aprobadas.
- Sintaxis frontend: 24/24 bloques/archivos aprobados.
- La prueba `auth-v7100.test.js` no inicia en este entorno porque `node_modules/bcryptjs` no contiene el paquete instalado. No se reemplazó bcrypt por una simulación.
- El navegador Chromium disponible en este entorno no completa su inicialización, incluso con una página HTML mínima; por eso no se considera ejecutado un smoke browser end-to-end real.

## Regla de despliegue

No promover todavía a producción hasta ejecutar un smoke test end-to-end en una instancia de staging con dependencias instaladas y PostgreSQL accesible.
