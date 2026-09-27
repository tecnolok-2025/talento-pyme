# Talento PyME 7.10.1 — LEER PRIMERO

**Fecha:** 27/09/2026 · **Build:** 20260927_02  
**Estado:** versión candidata auditada contra 509 candidatos reales. **NO desplegada.**

## Qué se hizo

Partiendo de v7.10.0, se ejecutó el clasificador sobre una copia saneada del backup real de Neon con **509 candidatos**. La prueba mostró que v7.10.0 había corregido la inflación de v7.9.16, pero era demasiado conservadora en varios CV con experiencia auténtica.

v7.10.1 ajusta esos falsos negativos sin volver a usar textos repetidos o generados como prueba de experiencia. También corrige el cálculo de períodos laborales para no sumar fechas educativas mezcladas con experiencia.

## Resultado del padrón real

- 509/509 registros procesados sin error.
- 215 perfiles quedan por completar, contra 273 en v7.10.0.
- 286 obtienen puntaje, contra 234 en v7.10.0.
- 3 quedan como Senior provisional, contra 306 Senior en v7.9.16.
- Se recuperan perfiles reales de comercio/atención, logística, vigilancia, limpieza, gastronomía, salud, tesorería, proyectos, obra, mantenimiento, producción y otras especialidades.
- La ausencia de evidencia suficiente sigue devolviendo N/D o nivel por verificar; no se inventa experiencia.

## Qué NO se hizo

- No se modificó Neon.
- No se modificó ni reemplazó la v7.9.16 que está funcionando.
- No se desplegó v7.10.1 en Render.
- El ZIP no incluye el backup real ni los 509 candidatos.

## Pruebas

- 214/214 pruebas de regresión no-auth aprobadas.
- 94/94 pruebas focalizadas en clasificación/búsqueda aprobadas (incluidas dentro de las anteriores).
- 509/509 candidatos reales comparados sin errores del motor.
- La prueba aislada de autenticación no pudo iniciarse localmente porque faltan los archivos del paquete `bcryptjs` en el `node_modules` disponible offline. Debe repetirse con `npm ci` completo antes de producción.

## Todavía NO instalar

Antes de subir esta revisión a GitHub/Render falta una etapa: **verificación funcional y gráfica en navegador**, incluyendo candidato, empresa y administración. Recién después de esa comprobación debe decidirse el despliegue.

Detalle completo: `AUDITORIA_v7.10.1.md`  
Resultados técnicos: `AUDIT_TEST_RESULTS_v7.10.1.txt`
