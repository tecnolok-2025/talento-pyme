# Talento PyME v7.10.7 · Release final

## Objetivo

Ajustar la normalización territorial observada en producción después del despliegue de v7.10.6.

## Cambios

- Localidades compuestas sólo por números/separadores pasan a **Ciudad no informada**.
- Se elimina el uso de código postal numérico como ciudad para agrupación.
- `San Cayetano` y `Barrio San Cayetano` se consolidan como **Campana**.
- El cambio se aplica a Panel General, reportes y filtros/búsquedas que usan la residencia normalizada.
- Los datos fuente del candidato permanecen intactos.

## Compatibilidad

Actualización directa: **v7.10.6 -> v7.10.7**.
No hay cambios de base de datos ni migraciones adicionales.
