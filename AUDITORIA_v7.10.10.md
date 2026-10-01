# Auditoría Talento PyME v7.10.10

## Objetivo
Permitir reutilizar el último correo institucional enviado desde **Correo / Consultas** para alcanzar únicamente a las personas o empresas incorporadas después y que todavía no recibieron esa misma comunicación.

## Implementación
- Nuevo endpoint administrativo `GET /admin/communications/latest-template?audience=...`.
- Recupera el último `AdminCommunication` del padrón seleccionado que tenga al menos un envío efectivo (`sentCount > 0`).
- Devuelve el **asunto y cuerpo originales sin modificación**.
- Reutiliza la lógica histórica existente `filterCommunicationRecipientsByHistory()` para calcular quiénes ya recibieron o tienen programada la misma comunicación.
- Nuevo botón en Administración: **Cargar último correo enviado**.
- Al cargarlo, queda marcada automáticamente la opción **Enviar sólo a quienes todavía no recibieron esta misma comunicación**.
- Cargar el correo no envía nada: el administrador conserva la decisión final mediante **Programar comunicación**.
- La cola protegida, límite de 450 correos en 24 horas, pacing, bajas y reintentos siguen sin cambios.
- La bienvenida automática existente continúa separada y con prioridad en la cola.

## Base de datos
No se agregan tablas, columnas ni migraciones.

## Validación
- Sintaxis de API validada con `node --check`.
- Suite: 249 pruebas descubiertas; 248 aprobadas.
- La única prueba no ejecutada correctamente en este entorno es `auth-v7100.test.js` porque el módulo local `bcryptjs` no está instalado en el runtime de auditoría. `bcryptjs` continúa declarado como dependencia del proyecto.
- Las pruebas nuevas específicas de v7.10.10 aprobaron.
