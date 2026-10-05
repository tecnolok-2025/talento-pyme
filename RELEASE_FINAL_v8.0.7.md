# Talento PyME v8.0.7 · Release final

## Objetivo
Unificar en un solo circuito las consultas que llegan desde Ayuda IA y las que llegan al correo institucional, evitando que rebotes de emails inválidos ensucien la operación o se repitan en campañas futuras.

## Funciones incorporadas
- Lectura directa de Gmail por IMAP.
- Sincronización manual + automática cada 30 minutos.
- Origen visible APP / EMAIL en Chat operador.
- Clasificación cubierta/nueva para ambos canales.
- Detección de rebote definitivo y temporal.
- Lista persistente de supresión para direcciones con rebote definitivo.
- Exclusión automática de direcciones suprimidas en campañas generales y guías de soporte.
- Protección adicional en la cola de bienvenida y en campañas ya encoladas.
- Rebotes fuera de la trazabilidad operativa; quedan como incidencia técnica.

## Base de datos
Migración `20261005_v807_unified_support_email`: agrega origen/externalRef a mensajes de soporte y tablas de correo entrante/supresión. Es aditiva e idempotente.

## Validaciones
- `node --check` del API: OK.
- JavaScript embebido de Administración: sintaxis OK.
- Pruebas focalizadas v8.0.7: 5/5 OK.
