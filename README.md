# Talento PyME — v7.9.7

## Novedades v7.9.7

- El CV habla desde la voz del candidato: la presentación ampliada, la motivación y el cierre se redactan **en primera persona**, no como una evaluación externa.
- **Corrección IA profesional** relee todo el relato y lo traduce a vocabulario técnico coherente con la profesión u oficio detectado, sin inventar antecedentes.
- La IA propone **10 aptitudes y fortalezas profesionales**, editables por el candidato.
- Genera una **motivación y objetivo profesional** adaptados a Aprendiz/Primer empleo, Junior, Semi-senior o Senior y contempla si la persona ya está trabajando.
- Genera un **cierre y proyección profesional** en primera persona.
- El candidato puede borrar, reemplazar, corregir, acortar o ampliar cualquiera de las propuestas antes de guardar.
- El PDF incorpora las nuevas secciones y admite continuidad multipágina cuando el contenido lo necesita.
- Nombre de CV: `YYMMDD-HHmm CV Nombre Apellido.pdf`.
- Administración muestra presentación, aptitudes, motivación, cierre, título detectado y años de experiencia.


Proyecto pensado como **Web + PWA instalable** (sin App Store / Play Store) + **API Node** + **PostgreSQL (Neon)**. La infraestructura puede combinar servicios gratuitos y pagos según la capacidad y las funciones habilitadas.

## Novedades v7.9.7

- Trazabilidad geográfica agregada por país de residencia y ciudad, sin cruce con expertise.
- La actividad empresarial de fallback se denomina “Actividad principal no especificada”; ya no se usa “Actividad general”.
- Candidato: nueva etapa 2 “Contanos con tus palabras · voz o texto”, con dictado compatible cuando el navegador lo permite, edición manual y guardado rápido para continuar más adelante. Talento PyME no conserva el audio original.
- Administración: la ficha del candidato muestra la presentación aprobada y la transcripción original.
- Candidato: descarga de CV profesional en PDF, con foto si existe y silueta neutra si no existe, usando datos actuales del perfil.
- El CV y la trazabilidad se regeneran con la información vigente; al actualizar el perfil, la próxima descarga refleja los cambios.

## Estado actual
- **Frontend (Static Site Render):** https://talento-pyme.onrender.com
- **API (Web Service Render):** https://talento-pyme-api.onrender.com
- **DB:** Neon (PostgreSQL) via Prisma.

## Accesos (sin confusión)
El portal conserva **3 maneras de ingreso**:
- **CANDIDATE (Candidato)**
- **COMPANY (Empresa)**
- **ADMIN / SUPERADMIN (Administración)**

> Candidato y empresa conservan sus funciones y visibilidad diferenciadas. Administración concentra la vista general, los perfiles completos, la trazabilidad, Factory Admin, la capacidad operativa y el chat operador.

> Importante: el PDF que venías adjuntando es una **exportación** (foto en el tiempo). Para que el PDF “muestre” la nueva versión, hay que volver a exportarlo. El origen de la versión es este README + la versión que muestra la app.

## Acceso (registro / ingreso)
- **Registro (primera vez):**
  - Candidato: Nombre y apellido, Email, DNI, Dirección, Localidad, Teléfono, Contraseña
  - Empresa: Contacto (Nombre y apellido), Empresa, CUIT, Email, Dirección, Localidad, Teléfono, Contraseña
- **Ingreso:**
  - Empresa: ingresa con **nombre de la empresa** + contraseña
  - Candidato: ingresa con **nombre y apellido** + contraseña
- **Recupero de contraseña:** DNI (candidato) o CUIT (empresa) sólo identifican la cuenta; el cambio de clave exige validar un código temporal enviado al correo registrado.


## Correo institucional único
- Talento PyME utiliza **una sola casilla institucional** para soporte, consultas, envío de códigos de recuperación y lectura del buzón desde Administración.
- La dirección institucional se toma exclusivamente de la variable existente `FACTORY_SUPPORT_EMAIL`.
- En la instalación actual esa variable corresponde a `talentopyme00@gmail.com`.
- Factory, Ayuda IA, recuperación de contraseñas y `Correo / Consultas` usan siempre esa misma dirección.
- No debe crearse ninguna segunda variable de identidad de correo.
- Para que Render pueda enviar y leer Gmail, Google exige además autorización de la cuenta mediante OAuth 2.0 o contraseña de aplicación; esas credenciales se guardan sólo en Render y no cambian la dirección institucional.

## PWA / caché
La PWA usa Service Worker con caché versionada (por ejemplo `tp-cache-4.3.0`) y un botón en Acceso **“Actualizar versión”** para forzar refresh.


## Versión única (anti-confusión)
- UI: `apps/web/config.js` → `TP_APP_VERSION = "7.9.10"`
- API: `apps/api/package.json` → `7.9.10` y endpoint `/health`.

## Administración de candidatos y empresas
- El contador administrativo toma todas las cuentas registradas como candidato, incluso si todavía no completaron el CV laboral.
- La pestaña **Perfiles candidatos** permite buscar por nombre, DNI o mail y abrir/cerrar cada ficha individual.
- La ficha del candidato muestra datos personales, perfil profesional, experiencia, formación, herramientas, resumen extraído del CV, observaciones, postulaciones y datos de acceso.
- La nueva pestaña **Perfiles empresas** permite buscar por empresa, contacto, CUIT o mail y abrir una ficha institucional/operativa completa.
- La ficha de empresa muestra identidad, contacto, resumen institucional, búsquedas, actividad comercial/Factory y soporte.
- Desde ambas fichas, Administración puede **enviar una recuperación segura por correo**; Administración no puede ver ni asignar contraseñas directamente.
- Cada candidato mantiene **Mantener indefinidamente** activado por defecto, con persistencia individual en la base.
- `npm start` aplica el ajuste de esquema requerido antes de iniciar la API, sin borrar los registros existentes.

### Clasificación administrativa v7.9.7
- **Empresas:** Administración conserva las tres familias **Fabricación**, **Logística** y **Servicio**, siempre con contador y ocultando grupos vacíos. Dentro de cada familia se abre una segunda capa por **actividad principal** (por ejemplo Metalurgia/Mecanizado, Transporte/Distribución, Mantenimiento industrial, Ingeniería/Proyectos, etc.), también con su cantidad.
- La actividad principal se infiere priorizando la descripción institucional y la identidad de la empresa; las búsquedas publicadas funcionan como respaldo. Si aparece una actividad no contemplada por el catálogo, el sistema genera una etiqueta administrativa dinámica en lugar de dejar la empresa sin clasificar. La familia puede corregirse manualmente desde la ficha y queda persistida en `CompanyProfile.adminCategory`.
- **Candidatos:** ningún perfil queda como “pendiente”. Administración los integra en **Aprendices / Pasantes / Primer empleo**, **Operativos / Oficios**, **Técnicos / Especialistas**, **Supervisión / Jefaturas**, **Profesionales / Ingeniería**, **Gerencia / Dirección** o **Administrativos / Gestión**.
- Dentro de cada grupo se muestran únicamente las expertise realmente presentes, con contador. Si la especialidad no coincide con el catálogo conocido, se crea automáticamente una **subcategoría dinámica** a partir del área, especialidad o titular profesional disponible.
- Para determinar la expertise se pondera con mayor fuerza la **actividad/rol más reciente** (último trabajo, especialidad y área actual) y luego el resto de la trayectoria/CV. Así, una experiencia histórica distinta no desplaza automáticamente la ocupación más nueva.
- Junto a cada candidato se muestra un **Índice de trayectoria 0–100** y un nivel orientativo: **Aprendiz/Pasante, Junior, Semi-senior o Senior**. Se recalcula en cada lectura administrativa cuando cambian el perfil o el CV. El cálculo utiliza únicamente evidencia profesional (experiencia, responsabilidad, formación, capacitación y contenido curricular) y excluye atributos personales sensibles. No es una recomendación automática de contratación.
- **Trazabilidad:** incorpora una fotografía general de candidatos por expertise y empresas por familia y actividad principal. El seniority individual no se mezcla con esa trazabilidad general.
- Toda esta clasificación es **exclusivamente administrativa**: no se muestra a candidatos ni empresas.

## Resguardo y capacidad operativa
- Panel de superadministración con semáforo de capacidad DB.
- Política visible de backup: automático diario, conservando los últimos 2 días, con respaldo externo del proveedor.
- Botón específico para **Ampliar capacidad DB** mediante URL configurable (`ADMIN_UPGRADE_URL`).
- Tabla histórica `AdminMonthlySnapshot` para consolidación mensual de trazabilidad.

> Importante: el tablero muestra y documenta la política de resguardo. La ejecución real del backup externo depende de que el proveedor/hosting tenga esa rutina activada en su consola.

- Protección anti-regresión del backup: si el resguardo nuevo cae bruscamente en peso o cantidad de registros frente al último backup confiable, el sistema lo bloquea y conserva la referencia anterior.
- Validación adicional para abrir **Ampliar capacidad DB** desde superadministración con clave personal de la sesión.

## Reportes ejecutivos de trazabilidad v7.9.7
- Nueva pestaña **Reportes** exclusiva de Administración.
- Genera en tiempo real el PDF **“Informe Ejecutivo de Trazabilidad, Evolución y Composición del Portal”**.
- El PDF se construye cada vez desde la base actual: no reutiliza reportes viejos.
- Incluye objetivo y alcance, resumen ejecutivo, comparación últimos 30 días vs. 30 anteriores, evolución de seis meses, composición de candidatos y empresas, calidad de información, conclusiones y sugerencias de mejora.
- El reporte es **agregado y anonimizado**: no incluye nombres, apellidos, DNI, CUIT, emails, teléfonos ni identificadores individuales.
- Puede descargarse como PDF o generarse y enviarse como adjunto desde el correo institucional definido por `FACTORY_SUPPORT_EMAIL`.
- El destinatario puede editarse desde Administración. `TRACEABILITY_REPORT_RECIPIENT` es opcional y sólo define el valor sugerido por defecto.
- La creación del PDF utiliza `pdfkit`; Render instalará la dependencia al reconstruir el API.


## v7.9.8 · Mensajes administrativos por email

En Administración > Chat operador se puede guardar una respuesta dentro de Talento PyME y, opcionalmente, enviar exactamente ese mismo mensaje al correo registrado del candidato o empresa mediante la cuenta institucional configurada en `FACTORY_SUPPORT_EMAIL`.

- `Responder en Talento PyME`: guarda el mensaje únicamente en el hilo del portal.
- `Responder + enviar por email`: guarda el mensaje en el hilo y lo envía por Gmail.
- `Reenviar último mensaje informado por email`: vuelve a enviar el último mensaje del operador sin duplicarlo dentro del chat.

El panel muestra el destinatario antes de enviar y conserva párrafos/saltos de línea. Los envíos administrativos registran un evento de seguridad con el correo enmascarado. No se agregan variables de entorno ni cambios de Prisma.

## v7.9.10 · Comunicaciones institucionales con cola automática protegida

Dentro de **Administración > Correo / Consultas** se mantiene la comunicación separada a candidatos y empresas, pero el envío ya no se ejecuta de golpe desde el navegador. Cada campaña queda guardada en una **cola persistente en PostgreSQL/Neon** y es procesada por el servidor de Render.

- **Comunicación a candidatos** y **Comunicación a empresas** conservan sus encabezados institucionales y el pie automático de baja.
- El límite interno es de **450 comunicaciones masivas en cualquier ventana móvil de 24 horas**. Es más conservador que un simple cambio de fecha y el código no permite configurarlo por encima de 450.
- El servidor envía **un correo por vez**, con una separación mínima predeterminada de 60 segundos entre mensajes.
- Si una campaña consume el cupo disponible de las últimas 24 horas, pasa a `WAITING_DAILY_LIMIT` y continúa automáticamente cuando el envío más antiguo sale de esa ventana. En la práctica, los pendientes continúan al día siguiente sin intervención del administrador.
- Sólo se procesa **una campaña por vez**. Si Administración programa otra comunicación mientras existe una anterior pendiente, la nueva queda en cola y no adelanta a la primera.
- La cola sigue funcionando aunque el administrador cierre la pestaña o salga de Talento PyME; el estado está persistido en la base.
- Si Render reinicia, el worker vuelve a leer la cola y continúa respetando el último envío registrado y el límite diario.
- Antes de cada email se vuelve a verificar la preferencia `bulkEmailOptOutAt`; una baja posterior a la creación de la campaña también es respetada.
- Errores temporales de red se reintentan automáticamente. Si Gmail informa cuota o limitación temporal, la campaña se pausa y continúa al día siguiente.
- El panel muestra uso de las últimas 24 horas, disponibilidad actual, cantidad de campañas en cola, estado y progreso de la campaña activa.
- Como resguardo extraordinario, Administración dispone de **Cancelar pendientes de esta comunicación**; sólo detiene lo que todavía no salió y no afecta los correos ya enviados.
- Se reutilizan `FACTORY_SUPPORT_EMAIL` y `GMAIL_APP_PASSWORD`; no se agregan credenciales nuevas.

El límite de 450 se reserva específicamente para comunicaciones generales, dejando un margen prudente para recuperaciones de contraseña, mensajes individuales, reportes y posibles envíos manuales externos. Talento PyME no puede contabilizar los correos que una persona envíe manualmente directamente desde Gmail, por eso se mantiene ese margen.

## v7.9.11 — onboarding, comunicaciones y CV integrado
- Comunicaciones repetidas: por defecto sólo destinatarios que todavía no recibieron la misma comunicación.
- Bienvenida automática a nuevas altas CANDIDATE/COMPANY mediante la cola SMTP protegida.
- Campañas + bienvenidas comparten un techo interno de 450 envíos automáticos en 24 h.
- Registro candidato agrega Provincia/Estado/Región y País; trazabilidad agrega País + Provincia/Región + Ciudad.
- Corrección IA profesional fusiona Presentación Personal con el CV previamente analizado y evita duplicaciones.
- Botón `Ver CV tipo` con un ejemplo ficticio completo.
