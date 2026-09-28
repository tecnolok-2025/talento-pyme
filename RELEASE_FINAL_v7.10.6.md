# Talento PyME v7.10.6 · Release final

## Objetivo

Mejorar la presentación territorial y dar trazabilidad completa a bajas/rehabilitaciones de comunicaciones sin alterar datos originales ni cambiar funciones estables de v7.10.4.

## Cambios visibles

- Localidades equivalentes se agrupan de forma limpia en Panel General, reportes y búsqueda Empresa.
- En Administración, el número **No enviar / baja** abre el detalle de las cuentas excluidas.
- Cada cuenta puede mostrar desde cuándo está de baja, la vía registrada y el historial de cambios.
- Una rehabilitación manual exige un motivo y queda atribuida al administrador cuando el sistema dispone de esa identidad.

## Cambios internos

- Nuevo modelo `CommunicationPreferenceEvent`.
- Migración aditiva `20260928_v7106_communication_history`.
- Backfill conservador de bajas anteriores.
- Historial protegido contra UPDATE/DELETE normal.
- Scripts de simulación y rollback controlado incluidos.

## Compatibilidad

Actualización directa: **v7.10.4 -> v7.10.6**.

No instalar v7.10.5 antes: sus cambios ya están incorporados.
