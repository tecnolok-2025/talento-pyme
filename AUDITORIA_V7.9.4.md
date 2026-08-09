# Auditoría Talento PyME v7.9.5

## Alcance
Revisión de regresión y seguridad sobre v7.9.3, focalizada en presentación profesional por voz/texto, seniority, residencia, CV y visualización administrativa.

## Hallazgo reproducido
El CV de prueba podía conservar una transcripción casi literal y mostrar `Junior` aun cuando el relato declaraba alrededor de 40 años de experiencia, supervisión y proyectos de ingeniería. La v7.9.5 elimina esa contradicción mediante extracción explícita de años y ponderación de responsabilidades recientes.

## Presentación profesional
- El frontend espera 3 segundos tras finalizar reconocimiento de voz y 3,6 segundos de inactividad al escribir antes de solicitar un nuevo análisis.
- Cada análisis recibe el relato completo, no sólo el último fragmento.
- El candidato puede editar la propuesta antes de guardarla.
- Una edición posterior invalida el análisis anterior y provoca un nuevo procesamiento integral.

## IA y privacidad
- Integración opcional server-side con OpenAI Responses API mediante `OPENAI_API_KEY`.
- `store:false` en la solicitud.
- Structured Output con resumen, años, seniority, título, expertise y evidencia.
- No se envían nombre, DNI, correo, teléfono, dirección ni otros datos de contacto al modelo.
- Existe fallback local determinístico si la API no está configurada o no responde.

## Seniority
- Los años explícitos de experiencia se detectan en relato, resumen o experiencia curricular.
- Los años explícitos prevalecen sobre una etiqueta textual aislada de Junior.
- Prueba específica: 40 años + supervisión/proyectos => Senior, índice de trayectoria >= 90.
- El índice no utiliza nacionalidad, estado civil, hijos, foto, domicilio ni sueldo pretendido.

## Residencia
Se incorporó inferencia local controlada para localidades argentinas inequívocas. El sistema no usa una inferencia genérica abierta que pueda inventar países: sólo normaliza coincidencias conocidas o provincias argentinas ya declaradas.

## Compatibilidad
- Los candidatos existentes no se eliminan ni descartan.
- La nueva presentación profesional figura pendiente hasta ser reprocesada con la versión de análisis actual.
- Los campos nuevos de Prisma son opcionales y se agregan sin reset de la base.

## Validación
- 85/85 pruebas automáticas aprobadas.
- 27 archivos JavaScript validados con `node --check`.
- 16 scripts inline de 16 HTML validados.
- Sin referencias ejecutables a v7.9.3 en `apps/`.
- API, frontend y service worker unificados en v7.9.5.
