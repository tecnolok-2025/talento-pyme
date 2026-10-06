# Release Talento PyME v8.0.11

## Corrección
La búsqueda de empresas ahora contempla títulos académicos/profesionales declarados aunque la clasificación principal del candidato esté expresada con otro rótulo.

Ejemplo: una persona clasificada como Producción o Ingeniería y oficina técnica, pero con formación `Ingeniería Industrial`, será encontrable buscando `ingeniero`, `ingeniera` o `ingeniería`.

## Seguridad funcional
El cambio expande sólo el texto indexado para búsqueda. `profileScore`, `classKey`, `expertiseKey`, seniority y reglas de clasificación permanecen sin cambios.

## Validación
Pruebas focalizadas: 7/7 aprobadas.
