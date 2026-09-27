# Talento PyME — v7.10.4 FINAL

Fecha de cierre: 27/09/2026

## Estado

**Versión definitiva de código para despliegue controlado.**

Esta versión es funcionalmente idéntica a la candidata `v7.10.4-PREINSTALACION-AUDITADA`. No se introdujeron cambios adicionales en backend, frontend, clasificador, recuperación de contraseña, migración ni esquema Prisma durante el cierre final.

## Base de producción

Producción actual antes del despliegue: **v7.9.16**.

La actualización se realiza directamente de v7.9.16 a v7.10.4 FINAL. No es necesario instalar v7.10.0, v7.10.1, v7.10.2 ni v7.10.3.

## Alcance consolidado

- clasificación profesional calibrada contra el padrón real;
- clasificación automática versionada y persistente;
- detección de altas y modificaciones futuras;
- procesamiento por lotes e idempotencia por fingerprint;
- fechas laborales mejoradas sin mezclar formación con experiencia;
- búsquedas de Administración y Empresa basadas en el mismo clasificador;
- lectura profesional ampliada para Empresa;
- roles Profile / Resume / Bolsa explícitamente restringidos a CANDIDATE;
- recuperación de contraseña por correo conservada sin cambios funcionales;
- migración aditiva e idempotente;
- rollback seguro a v7.9.16 sin intentar eliminar el esquema nuevo.

## Validaciones realizadas

- 513 candidatos reales procesados por el motor sin errores;
- clasificación automática equivalente a la clasificación directa;
- segunda pasada idempotente: candidatos sin cambios omitidos correctamente;
- estructura y rutas de v7.9.16 conservadas;
- cambios de base de datos exclusivamente aditivos;
- 231 pruebas automáticas aprobadas de 232 detectadas en la última suite local;
- la única prueba no ejecutable correctamente en el entorno local fue `auth-v7100.test.js` por ausencia física de `bcryptjs` en `node_modules`; `bcryptjs` permanece declarado en `package.json` y `package-lock.json`;
- pruebas específicas de preinstalación y controles de sintaxis frontend aprobados.

## Condición de despliegue

El paquete queda **cerrado**. No realizar nuevas modificaciones antes del despliegue salvo que una prueba real en staging/producción controlada revele un defecto concreto.

El smoke real de infraestructura debe realizarse inmediatamente después del despliegue controlado, verificando login, recuperación, roles, búsquedas, ficha Empresa, actualización de CV y clasificación automática. Ante una anomalía, utilizar el paquete `Talento-PyME-v7.9.16-ROLLBACK-SEGURO.zip` sin borrar las estructuras aditivas creadas por v7.10.4.
