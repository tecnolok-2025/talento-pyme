-- Talento PyME v7.10.6 · ROLLBACK CONTROLADO
-- Elimina SOLAMENTE LEGACY_OPT_OUT_SNAPSHOT creados por legacy-optout-backfill-v7.10.6.
-- NO modifica User, bulkEmailOptOutAt ni bulkEmailOptOutReason.
-- CAMBIAR simulation a FALSE únicamente para una reversión técnica autorizada.

BEGIN;

CREATE TEMP TABLE _v7106_rollback_config(simulation BOOLEAN NOT NULL) ON COMMIT DROP;
INSERT INTO _v7106_rollback_config VALUES (TRUE);

CREATE TEMP TABLE _v7106_rollback_candidates ON COMMIT DROP AS
SELECT e."id",e."userId",e."emailSnapshot",e."idempotencyKey",e."createdAt"
FROM "CommunicationPreferenceEvent" e
WHERE e."action"='LEGACY_OPT_OUT_SNAPSHOT'
  AND e."source"='SYSTEM_MIGRATION'
  AND e."actorType"='SYSTEM'
  AND e."idempotencyKey"='legacy-optout:' || e."userId"
  AND COALESCE(e."metadata"->>'migration','')='legacy-optout-backfill-v7.10.6';

CREATE TEMP TABLE _v7106_user_before ON COMMIT DROP AS
SELECT u."id",u."email",u."bulkEmailOptOutAt",u."bulkEmailOptOutReason"
FROM "User" u
JOIN _v7106_rollback_candidates c ON c."userId"=u."id";

DO $$
DECLARE
  invalid_semantics INTEGER;
  duplicate_keys INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_semantics
  FROM _v7106_rollback_candidates c
  JOIN "CommunicationPreferenceEvent" e ON e."id"=c."id"
  WHERE e."previousOptOut" IS NOT NULL
     OR e."newOptOut" IS DISTINCT FROM TRUE
     OR e."actorUserId" IS NOT NULL;

  SELECT COUNT(*) INTO duplicate_keys
  FROM (
    SELECT e."idempotencyKey"
    FROM "CommunicationPreferenceEvent" e
    WHERE e."idempotencyKey" LIKE 'legacy-optout:%'
    GROUP BY e."idempotencyKey"
    HAVING COUNT(*)>1
  ) d;

  IF invalid_semantics>0 OR duplicate_keys>0 THEN
    RAISE EXCEPTION 'ROLLBACK CANCELADO: semántica inválida=%; claves duplicadas=%', invalid_semantics, duplicate_keys;
  END IF;
END $$;

SELECT
  CASE WHEN (SELECT simulation FROM _v7106_rollback_config)
       THEN 'SIMULACION — NO SE BORRARA NADA'
       ELSE 'ROLLBACK REAL'
  END AS modo,
  COUNT(*) AS eventos_identificados
FROM _v7106_rollback_candidates;

SELECT * FROM _v7106_rollback_candidates ORDER BY "createdAt";

DO $$
DECLARE
  sim BOOLEAN;
BEGIN
  SELECT simulation INTO sim FROM _v7106_rollback_config;
  IF NOT sim THEN
    -- La protección append-only se desactiva únicamente dentro de esta transacción
    -- y se reactiva antes de validar/confirmar.
    ALTER TABLE "CommunicationPreferenceEvent" DISABLE TRIGGER "communication_preference_event_no_mutation";

    DELETE FROM "CommunicationPreferenceEvent" e
    USING _v7106_rollback_candidates c
    WHERE e."id"=c."id"
      AND e."idempotencyKey"='legacy-optout:' || e."userId"
      AND e."action"='LEGACY_OPT_OUT_SNAPSHOT'
      AND e."source"='SYSTEM_MIGRATION'
      AND e."actorType"='SYSTEM'
      AND COALESCE(e."metadata"->>'migration','')='legacy-optout-backfill-v7.10.6';

    ALTER TABLE "CommunicationPreferenceEvent" ENABLE TRIGGER "communication_preference_event_no_mutation";
  END IF;
END $$;

DO $$
DECLARE
  sim BOOLEAN;
  changed_users INTEGER;
  remaining INTEGER;
BEGIN
  SELECT simulation INTO sim FROM _v7106_rollback_config;

  SELECT COUNT(*) INTO changed_users
  FROM _v7106_user_before b
  JOIN "User" u ON u."id"=b."id"
  WHERE u."email" IS DISTINCT FROM b."email"
     OR u."bulkEmailOptOutAt" IS DISTINCT FROM b."bulkEmailOptOutAt"
     OR u."bulkEmailOptOutReason" IS DISTINCT FROM b."bulkEmailOptOutReason";

  IF changed_users>0 THEN
    RAISE EXCEPTION 'ROLLBACK INVALIDO: % usuarios fueron modificados', changed_users;
  END IF;

  IF NOT sim THEN
    SELECT COUNT(*) INTO remaining
    FROM "CommunicationPreferenceEvent" e
    WHERE e."action"='LEGACY_OPT_OUT_SNAPSHOT'
      AND e."source"='SYSTEM_MIGRATION'
      AND e."actorType"='SYSTEM'
      AND e."idempotencyKey"='legacy-optout:' || e."userId"
      AND COALESCE(e."metadata"->>'migration','')='legacy-optout-backfill-v7.10.6';

    IF remaining<>0 THEN
      RAISE EXCEPTION 'ROLLBACK INCOMPLETO: permanecen % eventos', remaining;
    END IF;
  END IF;
END $$;

SELECT
  'REPORTE FINAL' AS reporte,
  (SELECT simulation FROM _v7106_rollback_config) AS simulation,
  (SELECT COUNT(*) FROM _v7106_rollback_candidates) AS eventos_objetivo;

COMMIT;
