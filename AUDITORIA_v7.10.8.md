# Talento PyME v7.10.8 — Auditoría de residencia

Corrección puntual y no destructiva solicitada luego de detectar un candidato con `Campana` cargado como localidad y también como provincia.

## Regla incorporada
- Si una ciudad inequívoca aparece cargada en el campo Provincia (por ejemplo `Campana`), se interpreta como una ciudad desplazada y se utiliza su provincia real.
- `Campana` en Provincia nunca se conserva como provincia: se normaliza a **Argentina · Buenos Aires · Campana**.
- El caso `localidad=Campana` + `provincia=Campana` queda expresamente cubierto.
- También se cubre `localidad=Ciudad no informada` + `provincia=Campana`, porque Campana es una señal territorial inequívoca.
- Se conserva la regla v7.10.7: una localidad compuesta sólo por números/separadores sigue siendo **Ciudad no informada**.
- San Cayetano continúa agrupándose dentro de Campana.
- No se reescriben datos originales del candidato; la corrección se aplica sólo a lectura, agrupación, búsqueda y reportes.

## Compatibilidad
- Sin cambios de schema ni migración Prisma.
- Sin cambios en login, correo, clasificación profesional ni historial de bajas.
- Motor de clasificación profesional permanece en 7.10.3.

## Prueba focal
- `Campana / Campana / Argentina` => `Campana / Buenos Aires / Argentina`.
- `Ciudad no informada / Campana / Argentina` => `Campana / Buenos Aires / Argentina`.
- Suite focal de residencia: 8/8 aprobada.
