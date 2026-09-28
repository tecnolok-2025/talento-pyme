# LEER PRIMERO · Talento PyME v7.10.6

Fecha: 28/09/2026

## Qué incluye

Esta versión se instala directamente sobre **v7.10.4**. No hace falta instalar v7.10.5 previamente.

1. Incluye la corrección territorial de v7.10.5: Campana/Zárate y otras localidades se agrupan con una residencia normalizada para pantalla, búsqueda y reportes, sin reescribir el dato original del candidato.
2. Agrega historial auditable de bajas y rehabilitaciones de comunicaciones.
3. Las bajas existentes se convierten en snapshots históricos conservando sólo los datos realmente existentes: fecha, correo y motivo legado disponible. No se inventan administrador, campaña, IP ni origen técnico.
4. Las nuevas bajas desde el propio email y las rehabilitaciones administrativas quedan registradas como eventos nuevos.
5. Administración puede abrir **No enviar / baja** y ver quién está excluido, desde cuándo y el historial asociado.

## Instalación

### Opción completa
Usar `Talento-PyME-v7.10.6-COMPLETA-AUDITADA.zip` como reemplazo completo del código.

### Opción parche
Usar `Talento-PyME-v7.10.4-A-v7.10.6-PARCHE.zip` sobre el repositorio que hoy está en v7.10.4. El parche ya contiene la normalización territorial de v7.10.5 y la trazabilidad de correo de v7.10.6.

Al iniciar Render, `npm start` ejecuta primero la migración v7.10.4 existente y luego la migración aditiva v7.10.6. Ambas son idempotentes.

## Qué NO cambia

- No se borra ni modifica ningún candidato, CV o empresa.
- No se cambia la lógica del motor de clasificación: sigue en 7.10.3.
- No se rediseña la recuperación de contraseña por correo.
- La baja de comunicaciones generales no desactiva la cuenta ni impide correos esenciales de seguridad.
- La normalización territorial no corrige físicamente la base: sólo mejora cómo se agrupa, busca y reporta.

## Seguridad de migración

Se incluyen dos scripts técnicos, no visibles para candidatos ni empresas:

- `apps/api/scripts/simulate_communication_history_v7106.sql`: simulación de solo lectura.
- `apps/api/scripts/rollback_communication_history_v7106.sql`: reversión controlada de los snapshots creados por esta migración, sin tocar `User` ni el estado real de baja.

El historial nuevo queda protegido como **append-only**: la aplicación no tiene operaciones de edición o borrado de eventos.
