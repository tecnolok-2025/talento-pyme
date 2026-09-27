# Talento PyME — Auditoría v7.10.2

Fecha de revisión: 27/09/2026

## Objetivo de esta revisión

La v7.10.2 transforma la clasificación calibrada con los 509 candidatos reales en un proceso permanente de la aplicación. El objetivo es que el mismo criterio aplicado en la auditoría siga funcionando solo cuando ingresen nuevos candidatos, incluso en incorporaciones masivas externas (por ejemplo, un futuro padrón proveniente de Ecoempleo).

No se modificó Neon ni la v7.9.16 de producción durante el desarrollo y las pruebas de esta revisión.

## Qué queda automatizado

La clasificación se dispara ante:

- alta de candidato;
- actualización o ampliación de perfil;
- carga o actualización de CV;
- análisis de CV;
- actualización de Bolsa / antecedentes;
- refinamiento de presentación profesional;
- incorporaciones externas detectadas directamente en PostgreSQL.

Además del disparo por evento, el servidor hace una revisión incremental cada 60 segundos y un barrido completo de reconciliación cada 6 horas por defecto. Ese barrido completo evita que quede sin clasificar una importación externa que preserve fechas antiguas o no utilice los endpoints habituales de Talento PyME.

## Persistencia y trazabilidad

Se incorpora de forma aditiva el modelo `CandidateClassification`. No reemplaza ni modifica `User`, `Profile`, `CandidateBolsa` ni `Resume`: almacena el resultado calculado, la versión del motor, el fingerprint de la evidencia profesional, fecha de clasificación, fundamento, evidencias y brechas.

El fingerprint no utiliza contraseñas, hashes, fotografía, seguridad, facturación ni campos derivados por IA. Un texto generado o reescrito por IA no se interpreta como nueva experiencia profesional.

La clasificación es idempotente: si el candidato ya fue procesado por la misma versión y no cambió la evidencia relevante, se omite el recálculo.

## Procesamiento masivo

La escritura se realiza en lotes de 100 registros por defecto. Si falla una transacción de lote, el sistema reintenta cada candidato individualmente para que un registro defectuoso no impida procesar los restantes.

Se ejecutaron dos simulaciones técnicas con 1.009 registros: 509 candidatos reales de la copia saneada + 500 duplicados anonimizados/renombrados utilizados únicamente para probar volumen. La prueba del clasificador procesó 1.009/1.009 sin errores. Además se ejecutó el pipeline exacto de clasificación + fingerprint + persistencia sobre un Prisma simulado: 1.009 clasificados, 1.009 persistidos, 0 errores y 11 transacciones de lote de hasta 100 registros. Ninguna de estas pruebas toca Neon. Los 500 adicionales no pretenden anticipar el contenido de futuros CV de Ecoempleo; validan estabilidad, automatización y capacidad con ese orden de magnitud.

## Regresión del clasificador

Se ejecutó v7.10.1 y v7.10.2 sobre los mismos 509 candidatos reales saneados.

- Candidatos comparados: 509.
- Errores: 0.
- Cambios sustantivos de clase, especialidad, seniority, puntaje, evidencia, fundamento o brechas: 0.
- Los únicos cambios esperados son de metadatos de versión (`7.10.1` → `7.10.2` y marcador de evidencia `V7101` → `V7102`).

Por lo tanto, la automatización no altera la calibración obtenida en v7.10.1.

## Pruebas

Suite general sin la prueba aislada de autenticación: 222/222 aprobadas.

La prueba `auth-v7100.test.js` no puede ejecutarse en este entorno de trabajo porque el `node_modules` local no contiene `bcryptjs`. `bcryptjs` continúa declarado correctamente como dependencia de `apps/api/package.json`, por lo que esto es una limitación del entorno local y no una sustitución ni simulación de la prueba.

Pruebas específicas nuevas v7.10.2: 8/8 aprobadas. Cubren:

- modelo persistente versionado;
- exclusión de secretos y datos no profesionales;
- hooks de todos los cambios profesionales principales;
- barrido inicial, incremental y reconciliación completa periódica;
- procesamiento en lotes y fallback por fila;
- estado y recuperación manual desde Administración;
- inclusión de la cache de clasificación en el backup lógico;
- parámetros automáticos por defecto.

## Cambio de base de datos

La diferencia de Prisma respecto de v7.10.1 es solamente aditiva:

1. una relación opcional `candidateClassification` en `User`;
2. la nueva tabla `CandidateClassification` y sus índices.

No se eliminaron ni renombraron columnas existentes.

## Administración

En Capacidad operativa se agrega el bloque **Clasificación automática de candidatos**, que muestra:

- versión activa del motor;
- total de candidatos;
- cuántos tienen clasificación de la versión vigente;
- pendientes;
- cola inmediata;
- intervalo incremental, barrido completo y tamaño de lote;
- resultado de la última ejecución;
- botón manual de recuperación `Procesar padrón ahora`.

El botón manual no es necesario para la operación normal: el proceso queda automático.

## Archivos de evidencia incluidos

- `AUDIT_TEST_RESULTS_v7.10.2.txt`
- `AUTH_TEST_v7.10.2.txt`
- `REGRESION_509_v7.10.1_v7.10.2.json`
- `SIMULACION_VOLUMEN_1009_v7.10.2.json`
- `SIMULACION_PIPELINE_1009_v7.10.2.json`

El paquete no incluye la copia con los 509 candidatos, backups de Neon, contraseñas, hashes ni credenciales.

## Estado

v7.10.2 queda como candidata técnica para continuar la verificación funcional/gráfica antes del despliegue. No instalar todavía en producción hasta completar ese último control.
