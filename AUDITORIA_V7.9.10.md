# Auditoría Talento PyME v7.9.10

## Objetivo
Reemplazar el envío masivo inmediato de v7.9.9 por una cola automática y persistente que proteja la cuenta institucional de Gmail y no dependa de que Administración permanezca abierta.

## Cambios principales

### 1. Cola persistente en Neon/PostgreSQL
- `AdminCommunication` incorpora estado operativo, fechas de inicio/finalización, espera y último error.
- Se agrega `AdminCommunicationRecipient`, con un registro por destinatario programado.
- La cola sobrevive al cierre del navegador y a reinicios del proceso de Render.

### 2. Límite conservador
- Máximo hard-stop: **450 comunicaciones masivas en cualquier ventana móvil de 24 horas**.
- Aunque exista una variable opcional, el código aplica `Math.min(450, ...)`, por lo que nunca puede configurarse por encima de 450.
- Se usa una ventana móvil de 24 h y no solamente el cambio de fecha, lo que evita enviar 450 antes de medianoche y otros 450 inmediatamente después.
- El margen restante queda disponible para correos operativos de Talento PyME y posibles envíos manuales externos a la aplicación.

### 3. Ritmo de envío
- Un único correo por vez.
- Separación mínima predeterminada: **60 segundos** entre comunicaciones masivas.
- El último envío se consulta en la base, por lo que el intervalo también se conserva después de un reinicio.

### 4. Una campaña por vez
- Las campañas se procesan FIFO por `createdAt`.
- Una segunda comunicación queda `QUEUED` hasta que la anterior finalice o sea cancelada.
- Una campaña en espera por cupo o reintento bloquea correctamente a las posteriores.

### 5. Continuación automática
- Al llegar al cupo de 450/24 h, la campaña pasa a `WAITING_DAILY_LIMIT`.
- El servidor calcula cuándo sale de la ventana de 24 h el envío más antiguo y retoma automáticamente cuando vuelve a existir cupo.
- Si Gmail informa cuota/rate limit, se aplica una pausa de seguridad de 24 horas.
- Errores temporales de red pasan a `WAITING_RETRY` y se reintentan automáticamente.

### 6. Baja de comunicaciones
- Antes de cada email se vuelve a leer `bulkEmailOptOutAt`.
- Si una persona pidió la baja después de que la campaña fue creada pero antes de recibir su turno, queda `SKIPPED_OPTOUT` y no recibe el correo.

### 7. Panel administrativo
Se muestran:
- enviados en las últimas 24 h;
- cupo disponible;
- campañas en cola;
- estado de la campaña activa;
- enviados, pendientes, fallidos y excluidos;
- ritmo actual.

El botón ahora dice **Programar comunicación** porque la petición web sólo crea la campaña; el SMTP se ejecuta en segundo plano.

### 8. Cancelación de emergencia
Se agregó **Cancelar pendientes de esta comunicación**. Sólo cancela correos todavía no enviados. Los correos que ya salieron no pueden retirarse.

## Esquema de base
Cambio aditivo. `prisma db push` agrega campos y la tabla `AdminCommunicationRecipient`. No se borran candidatos, empresas, CV, conversaciones ni comunicaciones anteriores.

## Seguridad y límites reales
Este mecanismo reduce significativamente el riesgo de bloquear Gmail, pero ninguna aplicación puede garantizar que Google nunca aplique controles antiabuso, reputación o restricciones adicionales. Talento PyME tampoco puede conocer los correos enviados manualmente desde la interfaz de Gmail. Por eso se eligieron 450/24 h y 60 s entre mensajes como límites internos conservadores.

## Validaciones realizadas
- API JavaScript: sintaxis correcta.
- 33 archivos JavaScript: sintaxis correcta.
- 18 pantallas HTML revisadas.
- 17 scripts inline HTML: sintaxis correcta.
- 120 pruebas Node: **120 aprobadas / 0 fallidas**.
- Versión unificada: **7.9.10**.

## Validación pendiente de producción
No se enviaron correos reales desde esta auditoría ni se conectó a la base Neon de producción. Después del deploy debe verificarse:
1. `prisma db push` exitoso.
2. Log de inicio del worker de comunicaciones.
3. Programar una comunicación real pequeña.
4. Confirmar que el contador avanza aproximadamente a un mensaje por minuto.
5. Confirmar recepción y baja de comunicaciones.
