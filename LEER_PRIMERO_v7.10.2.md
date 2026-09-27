# LEER PRIMERO — Talento PyME v7.10.2

## Estado

**NO DESPLEGADA.** La v7.9.16 y Neon de producción permanecen sin modificaciones.

La v7.10.2 conserva la clasificación calibrada en v7.10.1 y agrega la capacidad para mantenerla automáticamente cuando crezca el padrón.

## Qué resuelve

Si mañana ingresan 500 candidatos adicionales —por ejemplo desde Ecoempleo— no es necesario volver a realizar manualmente la auditoría que se hizo sobre los 509 actuales. La aplicación queda preparada para detectar nuevos registros y cambios profesionales, aplicar el mismo motor y registrar el resultado con la versión vigente.

El mecanismo combina cuatro defensas:

1. **Evento inmediato:** altas y actualizaciones desde Talento PyME se encolan al momento.
2. **Revisión incremental:** por defecto cada 60 segundos busca altas o cambios recientes.
3. **Barrido completo periódico:** por defecto cada 6 horas revisa todo el padrón, incluso para captar importaciones externas que no hayan pasado por los endpoints de la app.
4. **Fingerprint versionado:** si los antecedentes no cambiaron y ya se usó el motor vigente, no recalcula innecesariamente.

## Escala probada

Se procesaron técnicamente 1.009 registros (509 de la copia saneada + 500 simulados para volumen) sin errores. Una segunda prueba ejecutó el pipeline exacto de clasificación + fingerprint + persistencia sobre un Prisma simulado: 1.009 clasificados y persistidos, 0 errores, en 11 lotes de hasta 100. La escritura persistente tiene además reintento por candidato si un lote falla.

## Base de datos

Se agrega una única tabla nueva: `CandidateClassification`. El cambio es aditivo; no elimina ni renombra datos existentes.

## Variables nuevas

```env
CANDIDATE_CLASSIFICATION_AUTO_ENABLED="true"
CANDIDATE_CLASSIFICATION_SCAN_SECONDS="60"
CANDIDATE_CLASSIFICATION_BOOT_DELAY_MS="12000"
CANDIDATE_CLASSIFICATION_BATCH_SIZE="100"
CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS="6"
```

Todas tienen valores seguros por defecto. No hace falta declararlas para la prueba inicial salvo que se quiera cambiar la política.

## Validaciones realizadas

- 509/509 candidatos reales: v7.10.2 reproduce sin cambios sustantivos la clasificación de v7.10.1.
- 1.009/1.009 en simulación técnica de volumen: sin errores.
- 222/222 pruebas generales ejecutables en este entorno: aprobadas.
- 8/8 pruebas nuevas de clasificación automática: aprobadas.
- La prueba aislada de autenticación queda pendiente de un entorno con `bcryptjs` instalado; la dependencia continúa declarada en `package.json`.

## Antes de desplegar

Falta completar la verificación funcional/gráfica final de la aplicación completa. Hasta entonces, conservar v7.9.16 en producción.
