# Auditoría Talento PyME v7.9.11

Fecha: 10/08/2026

## Alcance
La versión parte de v7.9.10 e incorpora selección segura de destinatarios no informados, bienvenida automática, provincia/región en residencia y trazabilidad, fusión de Presentación Personal + CV analizado y un CV tipo ficticio.

## Seguridad de correo
- Límite compartido de 450 correos automáticos en ventana móvil de 24 horas para campañas y bienvenidas.
- Envío escalonado y persistente desde servidor.
- Bienvenida con prioridad; campañas generales continúan después sin simultaneidad intencional.
- Comunicaciones generales conservan baja/opt-out previa.
- Bienvenida se considera correo transaccional de confirmación de alta.
- No se agregan credenciales ni nuevas casillas de correo.

## No repetición de campañas
- Checkbox `communicationOnlyUnsent` tildado por defecto.
- Backend `onlyNotPreviouslySent` por defecto `true`.
- Se excluyen destinatarios con estado SENT o PENDING en una comunicación anterior equivalente.
- Al destildar se permite reenvío general explícito.

## Bienvenida
- Persistencia en User: queued/sent/attempt/error.
- Sólo las altas nuevas o finalizaciones seguras de cuentas legadas incompletas quedan encoladas; el despliegue no dispara bienvenidas masivas a toda la base histórica.
- Reintento automático ante fallas temporales.

## Residencia
- Registro candidato: Ciudad + Provincia/Estado/Región + País.
- Provincia y país son obligatorios en nuevas altas.
- Inferencia local únicamente para localidades inequívocas; para localidades desconocidas se conserva lo declarado.
- Trazabilidad: País / Provincia-Región / Ciudad.

## IA y CV
- Versión de análisis: `AI_V7_7.9.11_VOICE_CV_FUSION`.
- Fuentes profesionales enviadas a la corrección: relato, cargo reciente, expertise, CV summary, experiencia, educación, certificaciones y observaciones.
- No se envían nombre, DNI, email, teléfono ni domicilio a la corrección generativa.
- Cargar/modificar CV invalida el análisis anterior sin borrar el texto, obligando a pulsar de nuevo “Corrección IA profesional”.
- El currículum filtra líneas de experiencia con alto solapamiento semántico simple respecto de la presentación.

## CV tipo
- Endpoint autenticado `/candidate/cv/sample.pdf`.
- Datos completamente ficticios y marca visible `EJEMPLO · DATOS FICTICIOS`.

## Validación
- Suite Node: 131/131 pruebas aprobadas.
- 34 archivos JavaScript validados con `node --check`.
- 17 scripts inline HTML validados con `node --check`.
- `unzip -t` se ejecuta sobre el ZIP final antes de entrega.

## Migración
`npm start` conserva `prestart: prisma db push`; los cambios del schema son aditivos. No se programó eliminación ni reseteo de datos.
