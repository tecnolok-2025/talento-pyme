# Talento PyME v7.8.14 · Auditoría final previa a instalación

Fecha de revisión: 08/08/2026

## Alcance
Se revisó la consolidación de los cambios realizados desde v7.8.7 hasta v7.8.12: CV administrativo, privacidad de conteos, fichas de candidatos/empresas, recuperación segura de contraseña, migración de DNI legado, correo institucional único, Gmail en Administración, caché PWA y API.

## Hallazgos corregidos en v7.8.14

1. **Registro legado incompleto y contraseña**
   - Se detectó una compatibilidad antigua donde una cuenta existente sin perfil completo podía recibir un nuevo `passHash` al repetir el registro con el mismo email.
   - Corregido: el registro nunca reemplaza la clave de una cuenta existente. Para completar un perfil legado se debe validar la clave actual; si no se conoce, corresponde usar recuperación por correo.

2. **Endpoints de búsqueda legados**
   - `/search` y `/bolsa/search` eran rutas antiguas que ya no usa la interfaz vigente y podían entregar información de perfiles por fuera del circuito moderno de privacidad/capacidad.
   - Corregido: ambas rutas quedan retiradas y responden HTTP 410 sin entregar datos.

3. **Unicidad de DNI**
   - El alta nueva comprobaba `Profile.dni`, pero podía no contemplar un DNI histórico conservado sólo en `CandidateBolsa`.
   - Corregido: se comprueban ambos orígenes antes de crear una nueva cuenta.

4. **Normalización del nombre del candidato**
   - Al actualizar el perfil laboral podía cambiar `fullName` sin sincronizar `fullNameNorm`, afectando el ingreso por nombre luego de una corrección.
   - Corregido: ambos valores se sincronizan.

5. **Códigos de recuperación**
   - Podían coexistir varios códigos aún vigentes para la misma cuenta.
   - Corregido: cuando se envía correctamente un código nuevo, los desafíos anteriores quedan consumidos. Se agrega limpieza best-effort de desafíos antiguos.

6. **Política de contraseña**
   - El recupero exigía 10 caracteres pero el registro nuevo todavía aceptaba 8.
   - Corregido: candidatos y empresas nuevos usan mínimo 10 caracteres. El login sigue aceptando claves históricas de 8 o más para no bloquear cuentas existentes.

7. **Análisis de sitio web de empresa**
   - Se endureció contra SSRF: sólo acepta HTTP/HTTPS públicos, bloquea localhost/redes privadas, valida redirecciones, aplica timeout y limita la respuesta a 2 MB.

8. **Carga de CV**
   - La interfaz ofrecía imágenes aunque el parser no implementa OCR.
   - Corregido: interfaz y API quedan alineadas en PDF, DOCX y TXT. Un formato no soportado responde 415.

## Correo institucional
- Única identidad institucional: `FACTORY_SUPPORT_EMAIL`.
- Instalación actual: `talentopyme00@gmail.com` configurado en Render.
- Autorización Gmail: `GMAIL_APP_PASSWORD` en Render.
- No existe `TALENTO_PYME_EMAIL` en el runtime.
- La clave de aplicación no está incluida ni hardcodeada en este ZIP.

## Recuperación de contraseña
- Candidato: DNI.
- Empresa: CUIT.
- Código temporal de 6 dígitos enviado al correo registrado del usuario.
- Correo de destino se muestra enmascarado.
- Código con vencimiento, máximo de intentos y límite de solicitudes.
- Recién después de validar el código se permite elegir la nueva clave.
- Administración sólo puede disparar el envío de recuperación; no puede conocer ni asignar la contraseña.
- `/auth/reset-by-id` y el reset administrativo directo permanecen deshabilitados con HTTP 410.

## Privacidad
- Totales globales de candidatos/empresas permanecen sólo en Administración.
- La interfaz Empresa no recibe conteos por faceta ni total global de candidatos.
- Los antiguos endpoints alternativos de búsqueda quedaron cerrados para impedir bypass del circuito actual.

## Base de datos
- v7.8.14 no introduce un nuevo cambio de esquema respecto de v7.8.12.
- No contiene comandos para borrar candidatos, empresas, perfiles, CV, postulaciones o facturación.
- `prisma db push` conserva el mecanismo de despliegue existente.

## Validaciones ejecutadas
- `node --check` sobre todos los JS de API, frontend, pagos y tests.
- Extracción y validación sintáctica de 16 scripts inline de HTML: 0 errores.
- Batería Node: **36/36 pruebas aprobadas**.
- Verificación de versión runtime: frontend/API/cache = 7.8.14.
- Búsqueda de hardcodes de `factory@gmail.com` y `TALENTO_PYME_EMAIL` en runtime: ninguno.
- Búsqueda de credenciales reales hardcodeadas: ninguna.

## Prueba que debe realizarse después del deploy
No es posible probar desde el ZIP la cuenta Gmail real ni la base Neon real porque esas credenciales sólo existen en Render. Después de instalar v7.8.14 se debe hacer un smoke test en producción:
1. `/health` debe indicar v7.8.14.
2. Candidato: solicitar recuperación con un DNI de prueba y comprobar recepción del código.
3. Validar código y cambiar clave.
4. Empresa: repetir con CUIT de prueba.
5. Administración → Correo / Consultas: comprobar últimos 20 mensajes y abrir uno.
6. Administración: comprobar ficha completa de candidato y empresa.
7. Empresa: confirmar que no aparecen conteos globales de candidatos.

## Observación del deploy mostrado antes de instalar esta versión
La captura de Render previa a esta auditoría muestra el servicio **Live**, pero los logs indican `talento-pyme-api@7.8.9` y `Talento PyME API ... (v7.8.9)`. Eso confirma que agregar `GMAIL_APP_PASSWORD` dejó preparada la variable, pero todavía no instaló el código de correo/recuperación nuevo. La actualización efectiva se produce al desplegar v7.8.14.
