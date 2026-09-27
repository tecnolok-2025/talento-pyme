# Talento PyME 7.10.0 — Revisión de clasificación y acceso

Fecha: 27/09/2026. Base recibida: 7.9.16. Nueva revisión preparada para actualizar el repositorio existente. **No está desplegada.**

## Cambios principales

- Ingreso por DNI, correo o nombre. Los nombres toleran tildes, mayúsculas, orden nombre/apellido y errores pequeños, sin elegir una cuenta cuando hay homónimos.
- Contraseña: con identificación exacta de candidato/empresa, se aceptan espacios exteriores accidentales y variación de mayúscula/minúscula en la primera letra. No se corrigen letras internas. Si se usa un nombre aproximado, la clave debe coincidir exactamente. Administración conserva contraseña estricta. Recuperación por código al correo registrado y límite de intentos.
- Clasificación reconstruida a partir del último trabajo, experiencia curricular y relato original de tareas. No se usan las presentaciones ampliadas por IA como evidencia, ni se suman puntos por textos largos, cargos aislados o repetición.
- El puntaje representa evidencia provisional de la especialidad, no probabilidad de contratación. Datos insuficientes: sin puntaje. Falta de datos no implica falta de capacidad.
- Ficha breve con perfil, teléfono, teléfono adicional, correo, ciudad, dirección, estado civil, edad disponible, último trabajo y explicación de la clasificación. Los antecedentes completos quedan en un desplegable.
- Empresas y administración usan el mismo perfil calculado en sus búsquedas. Se puede encontrar por los términos de ese perfil aunque no figuren literalmente en el CV. Las aspiraciones y competencias agregadas por IA no se indexan como experiencia.
- Fecha de nacimiento y teléfono adicional opcionales en el formulario. Edad calculada con fecha válida; si el CV declara una edad, se indica que debe confirmarse su vigencia. Nunca se estima con DNI ni modifica el puntaje.
- El procesamiento nuevo del CV conserva los saltos de línea, elimina el perfil «senior» por defecto y no completa diez aptitudes inventadas.

## Actualización del proyecto

1. Conservar las variables de entorno actuales y realizar el respaldo habitual de la base.
2. Subir el contenido de esta carpeta al repositorio, respetando `apps/api` y `apps/web`.
3. API: build `npm ci && npx prisma generate`; inicio `npm start`. Mantener la raíz y los servicios que ya utiliza la instalación. `prestart` ejecuta el `prisma db push` existente: esta revisión sólo agrega dos campos opcionales a CandidateBolsa. No agregar `--accept-data-loss`, no ejecutar reset y no crear una base nueva.
4. Actualizar también el frontend. Conservar su URL de API vigente. Pulsar **Actualizar versión** y comprobar **7.10.0**, build **20260927_01**.
5. Abrir Trazabilidad → Perfiles candidatos. La clasificación se calcula al consultar los datos existentes; no hay que volver a registrar las personas.
6. Verificar en producción: ingreso candidato por DNI; ingreso empresa; recuperación de correo; guardado de fecha/teléfono adicional; consulta de fichas y búsquedas desde ambos roles.

## Alcance y límites

**203 pruebas pasaron**, incluyendo regresiones del proyecto y pruebas nuevas de clasificación, acceso y generación de la ficha. Prisma validó el esquema y generó el cliente. La auditoría de dependencias no informó vulnerabilidades conocidas en el conjunto instalado. Se actualizó Multer a la rama 2 y se incorporó lockfile.

El ZIP no contiene la base de las aproximadamente 500 personas. No se auditaron individualmente esos registros ni se probó la actualización contra la base de producción, SMTP o Render. La validación gráfica en navegador quedó pendiente porque no se pudo descargar Chromium; sí se verificó la generación y escape del HTML y la sintaxis de todos los scripts web. No debe interpretarse como una certificación integral del sistema en producción.

La clasificación es un motor conservador de reglas y evidencia textual, no una verificación externa de títulos o experiencia. Los CV ambiguos o mal estructurados pueden quedar sin especialidad. Esto es preferible a atribuir un oficio no respaldado. Un registro sin antecedentes no se convierte automáticamente en administrativo: una escuela técnica permite sugerir orientación a pasantía técnica, sin acreditar experiencia. Debe completarse y validarse el perfil.

Detalle de hallazgos y criterios: `AUDITORIA_v7.10.0.md`. Resultado reproducible: `AUDIT_TEST_RESULTS_v7.10.0.txt`; desde `apps/api`, ejecutar `npm ci`, `npx prisma generate` y `npm test`.
