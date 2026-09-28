# Auditoría Talento PyME v7.10.6

Fecha: 28/09/2026

## Alcance

v7.10.6 integra dos trabajos sobre la base estable v7.10.4:

- normalización territorial no destructiva preparada en v7.10.5;
- historial auditable de bajas y rehabilitaciones de comunicaciones.

No es necesario desplegar v7.10.5 como paso intermedio.

## Residencia

Se conserva `normalizeResidenceForGrouping()` como capa de lectura. Sobre el backup auditado de 513 candidatos, la presentación territorial pasó de 47 agrupaciones a 18, con 35 filas normalizadas y 0 datos fuente modificados. Los números reales pueden variar porque producción ya tiene más candidatos.

## Historial de comunicaciones

Se agrega `CommunicationPreferenceEvent` con:

- acción: baja, rehabilitación o snapshot histórico;
- estado anterior y nuevo;
- fecha y hora;
- vía/origen;
- administrador responsable cuando corresponde;
- motivo administrativo;
- referencia opcional a campaña/destinatario;
- `idempotencyKey` para la migración histórica.

Las bajas existentes se migran como `LEGACY_OPT_OUT_SNAPSHOT` con `source=SYSTEM_MIGRATION`. Se conserva `bulkEmailOptOutAt` y `bulkEmailOptOutReason`; no se modifica `User` durante el backfill.

## Reglas de seguridad

- migración aditiva e idempotente;
- sin `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, renombres ni transformaciones destructivas; el único `DROP` automático es del trigger propio para recrearlo de forma idempotente;
- control de fechas futuras, emails vacíos y conflictos de idempotencia;
- control posterior: toda baja vigente debe quedar con al menos un evento histórico o real;
- trigger PostgreSQL `BEFORE UPDATE OR DELETE` bloquea la modificación/borrado normal del historial;
- rollback técnico identifica simultáneamente `action`, `source`, `actorType`, `idempotencyKey` y `metadata.migration`;
- rollback no actualiza ni elimina registros de `User`.

## Administración

- El contador **No enviar / baja** permite abrir el detalle individual.
- Se muestra persona/empresa, correo, fecha vigente de baja, origen disponible e historial.
- En una baja histórica reconstruida la interfaz aclara que se trata de un dato legado y no atribuye un administrador inexistente.
- Una rehabilitación manual exige motivo y registra al administrador autenticado cuando existe en la base; el acceso administrativo virtual queda identificado mediante snapshot textual.

## Baja desde el email

El candidato o empresa mantiene el mecanismo existente desde el propio correo. La baja crea un evento `OPT_OUT` y actualiza el estado vigente dentro de la misma transacción.

Los nuevos tokens de comunicaciones incluyen, cuando corresponde, campaña y destinatario para mejorar trazabilidad. Los tokens antiguos sin ese contexto continúan siendo compatibles.

## Pruebas

- Suite sin la prueba aislada de autenticación: **244/244 aprobadas**.
- Suite total detectada: **245 pruebas; 244 aprobadas**.
- Única prueba no ejecutable en este entorno: `auth-v7100.test.js`, porque `bcryptjs` no está físicamente instalado en el contenedor de auditoría. La dependencia permanece declarada en `package.json` y `package-lock.json`.
- Sintaxis Node de `src/index.js`: OK.
- Sintaxis del JavaScript inline de `admin.html`: OK.
- Pruebas focalizadas residencia + historial de comunicaciones: **13/13 aprobadas**.

## Resultado

v7.10.6 queda preparada como actualización directa desde v7.10.4, con opción completa y parche reducido.
