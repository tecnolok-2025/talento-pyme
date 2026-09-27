# Talento PyME v7.10.4 — Migración y rollback seguro

## Principio

El cambio desde v7.9.16 es **aditivo**. No se autoriza borrar, renombrar ni transformar datos existentes.

### Objetos nuevos

- `CandidateBolsa.fechaNacimiento` (opcional)
- `CandidateBolsa.telefonoAdicional` (opcional)
- tabla `CandidateClassification` e índices asociados

## Cambio de despliegue

A partir de v7.10.4, `npm start` **ya no ejecuta `prisma db push`**. El `prestart` ejecuta:

1. `prisma generate`
2. `prisma db execute` con `prisma/migrations/20260927_v7104_additive/migration.sql`

Ese SQL usa `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`. No contiene `DROP`, `TRUNCATE`, `RENAME` ni `ALTER COLUMN`.

## Secuencia de instalación recomendada

1. Descargar un backup lógico inmediatamente antes del despliegue.
2. Confirmar que el backup informa el número esperado de candidatos y empresas.
3. Desplegar v7.10.4 en staging o instancia de validación.
4. Verificar `/health` y la versión 7.10.4.
5. Verificar login de Administración, Empresa y Candidato.
6. Verificar recuperación por correo sin cambiar su lógica.
7. Verificar búsqueda Empresa y apertura de ficha completa.
8. Verificar clasificación automática y estado administrativo.
9. Recién después promover la misma revisión a producción.

## Rollback seguro

**No** se debe restaurar el ZIP original v7.9.16 si mantiene `prestart: prisma db push`, porque el esquema antiguo podría intentar reconciliar hacia atrás objetos agregados por v7.10.4.

Se entrega un paquete separado `Talento-PyME-v7.9.16-ROLLBACK-SEGURO.zip` cuyo código funcional es v7.9.16 pero cuyo `prestart` ejecuta solamente `prisma generate`.

El rollback seguro:

- revierte el código;
- conserva `CandidateClassification` y las dos columnas opcionales;
- no borra datos;
- v7.9.16 ignora los objetos adicionales que no conoce.

No ejecutar `prisma db push --accept-data-loss`, `migrate reset`, `DROP TABLE` ni eliminación manual de columnas durante el rollback.
