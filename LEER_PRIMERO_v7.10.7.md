# Talento PyME v7.10.7 · LEER PRIMERO

Esta revisión parte de **v7.10.6 ya instalada** y corrige únicamente dos criterios de presentación territorial:

1. Una localidad compuesta sólo por números o separadores (por ejemplo `1_2814`, `2804` o un teléfono) se agrupa como **Ciudad no informada**.
2. `San Cayetano` y `Barrio San Cayetano` se agrupan como **Campana, Buenos Aires, Argentina**.

## Seguridad del cambio

- No modifica los valores originales guardados por los candidatos.
- No modifica Prisma ni crea una migración nueva.
- No toca historial de bajas, campañas de correo, login, recuperación ni clasificación profesional.
- Se mantiene el motor de clasificación **7.10.3**.

## Instalación

Puede instalarse el ZIP completo o el parche directo **v7.10.6 -> v7.10.7**.
