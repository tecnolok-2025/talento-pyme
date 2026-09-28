-- Talento PyME v7.10.6 · SIMULACIÓN DE BAJAS HISTÓRICAS
-- Sólo lectura. No modifica User ni CommunicationPreferenceEvent.

SELECT
  'SIMULACION — SIN CAMBIOS' AS modo,
  COUNT(*) AS bajas_actuales,
  COUNT(*) FILTER (WHERE "email" IS NULL OR btrim("email")='') AS emails_invalidos,
  COUNT(*) FILTER (WHERE "bulkEmailOptOutAt" > CURRENT_TIMESTAMP + INTERVAL '5 minutes') AS fechas_futuras,
  COUNT(*) FILTER (WHERE "bulkEmailOptOutReason" IS NULL OR btrim("bulkEmailOptOutReason")='') AS motivos_no_registrados
FROM "User"
WHERE "bulkEmailOptOutAt" IS NOT NULL;

SELECT
  "id" AS user_id,
  "email",
  "bulkEmailOptOutAt" AS baja_desde,
  COALESCE(NULLIF(btrim("bulkEmailOptOutReason"),''),'LEGACY_REASON_NOT_RECORDED') AS motivo_disponible,
  'legacy-optout:' || "id" AS idempotency_key
FROM "User"
WHERE "bulkEmailOptOutAt" IS NOT NULL
ORDER BY "bulkEmailOptOutAt";

DO $$
DECLARE
  table_exists BOOLEAN;
  conflicts INTEGER := 0;
  already_migrated INTEGER := 0;
BEGIN
  table_exists := to_regclass('public."CommunicationPreferenceEvent"') IS NOT NULL;
  IF table_exists THEN
    EXECUTE $q$
      SELECT COUNT(*)
      FROM "User" u
      JOIN "CommunicationPreferenceEvent" e
        ON e."idempotencyKey"='legacy-optout:' || u."id"
      WHERE u."bulkEmailOptOutAt" IS NOT NULL
        AND (
          e."userId"<>u."id"
          OR e."action"::text<>'LEGACY_OPT_OUT_SNAPSHOT'
          OR e."source"::text<>'SYSTEM_MIGRATION'
          OR e."actorType"::text<>'SYSTEM'
          OR e."previousOptOut" IS NOT NULL
          OR e."newOptOut" IS DISTINCT FROM TRUE
        )
    $q$ INTO conflicts;

    EXECUTE $q$
      SELECT COUNT(*)
      FROM "User" u
      JOIN "CommunicationPreferenceEvent" e
        ON e."idempotencyKey"='legacy-optout:' || u."id"
      WHERE u."bulkEmailOptOutAt" IS NOT NULL
    $q$ INTO already_migrated;
  END IF;

  RAISE NOTICE 'Tabla histórica existente: %', table_exists;
  RAISE NOTICE 'Eventos ya migrados: %', already_migrated;
  RAISE NOTICE 'Conflictos de idempotencyKey: %', conflicts;
  IF conflicts > 0 THEN
    RAISE WARNING 'SIMULACION: hay conflictos. No ejecutar la migración real hasta revisarlos.';
  ELSE
    RAISE NOTICE 'SIMULACION: no se detectaron conflictos bloqueantes de idempotencia.';
  END IF;
END $$;
