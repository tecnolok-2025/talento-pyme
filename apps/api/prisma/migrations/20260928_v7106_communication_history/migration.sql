-- Talento PyME v7.10.6
-- Historial de bajas/rehabilitaciones de comunicaciones.
-- Migración aditiva, idempotente y conservadora.
-- No elimina ni transforma datos de User.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommunicationPreferenceAction') THEN
    CREATE TYPE "CommunicationPreferenceAction" AS ENUM ('OPT_OUT','OPT_IN','LEGACY_OPT_OUT_SNAPSHOT');
  END IF;
END $$;

ALTER TYPE "CommunicationPreferenceAction" ADD VALUE IF NOT EXISTS 'OPT_OUT';
ALTER TYPE "CommunicationPreferenceAction" ADD VALUE IF NOT EXISTS 'OPT_IN';
ALTER TYPE "CommunicationPreferenceAction" ADD VALUE IF NOT EXISTS 'LEGACY_OPT_OUT_SNAPSHOT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommunicationPreferenceSource') THEN
    CREATE TYPE "CommunicationPreferenceSource" AS ENUM ('SELF_SERVICE_LINK','EMAIL_PROVIDER_ONE_CLICK','ADMIN_PANEL','ADMIN_MAIL_REPLY','SYSTEM_MIGRATION');
  END IF;
END $$;

ALTER TYPE "CommunicationPreferenceSource" ADD VALUE IF NOT EXISTS 'SELF_SERVICE_LINK';
ALTER TYPE "CommunicationPreferenceSource" ADD VALUE IF NOT EXISTS 'EMAIL_PROVIDER_ONE_CLICK';
ALTER TYPE "CommunicationPreferenceSource" ADD VALUE IF NOT EXISTS 'ADMIN_PANEL';
ALTER TYPE "CommunicationPreferenceSource" ADD VALUE IF NOT EXISTS 'ADMIN_MAIL_REPLY';
ALTER TYPE "CommunicationPreferenceSource" ADD VALUE IF NOT EXISTS 'SYSTEM_MIGRATION';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommunicationPreferenceActorType') THEN
    CREATE TYPE "CommunicationPreferenceActorType" AS ENUM ('USER','ADMIN','EMAIL_PROVIDER','SYSTEM');
  END IF;
END $$;

ALTER TYPE "CommunicationPreferenceActorType" ADD VALUE IF NOT EXISTS 'USER';
ALTER TYPE "CommunicationPreferenceActorType" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "CommunicationPreferenceActorType" ADD VALUE IF NOT EXISTS 'EMAIL_PROVIDER';
ALTER TYPE "CommunicationPreferenceActorType" ADD VALUE IF NOT EXISTS 'SYSTEM';

CREATE TABLE IF NOT EXISTS "CommunicationPreferenceEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailSnapshot" TEXT NOT NULL,
  "action" "CommunicationPreferenceAction" NOT NULL,
  "previousOptOut" BOOLEAN,
  "newOptOut" BOOLEAN NOT NULL,
  "source" "CommunicationPreferenceSource" NOT NULL,
  "actorType" "CommunicationPreferenceActorType" NOT NULL,
  "actorUserId" TEXT,
  "actorNameSnapshot" TEXT,
  "actorEmailSnapshot" TEXT,
  "reasonCode" TEXT NOT NULL,
  "reasonText" TEXT,
  "communicationId" TEXT,
  "recipientId" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationPreferenceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_idempotencyKey_key"
  ON "CommunicationPreferenceEvent"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_userId_createdAt_idx"
  ON "CommunicationPreferenceEvent"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_emailSnapshot_createdAt_idx"
  ON "CommunicationPreferenceEvent"("emailSnapshot","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_action_createdAt_idx"
  ON "CommunicationPreferenceEvent"("action","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_source_createdAt_idx"
  ON "CommunicationPreferenceEvent"("source","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_actorUserId_createdAt_idx"
  ON "CommunicationPreferenceEvent"("actorUserId","createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationPreferenceEvent_communicationId_createdAt_idx"
  ON "CommunicationPreferenceEvent"("communicationId","createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_userId_fkey'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_actorUserId_fkey'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_communicationId_fkey'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_communicationId_fkey"
      FOREIGN KEY ("communicationId") REFERENCES "AdminCommunication"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_recipientId_fkey'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_recipientId_fkey"
      FOREIGN KEY ("recipientId") REFERENCES "AdminCommunicationRecipient"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_state_check'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_state_check"
      CHECK (
        (
          "action"='LEGACY_OPT_OUT_SNAPSHOT'
          AND "source"='SYSTEM_MIGRATION'
          AND "actorType"='SYSTEM'
          AND "previousOptOut" IS NULL
          AND "newOptOut"=TRUE
          AND "actorUserId" IS NULL
        )
        OR
        (
          "action"='OPT_OUT'
          AND "previousOptOut"=FALSE
          AND "newOptOut"=TRUE
        )
        OR
        (
          "action"='OPT_IN'
          AND "previousOptOut"=TRUE
          AND "newOptOut"=FALSE
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='CommunicationPreferenceEvent_source_actor_check'
      AND conrelid='"CommunicationPreferenceEvent"'::regclass
  ) THEN
    ALTER TABLE "CommunicationPreferenceEvent"
      ADD CONSTRAINT "CommunicationPreferenceEvent_source_actor_check"
      CHECK (
        ("source"='SELF_SERVICE_LINK' AND "actorType"='USER')
        OR ("source"='EMAIL_PROVIDER_ONE_CLICK' AND "actorType"='EMAIL_PROVIDER')
        OR ("source" IN ('ADMIN_PANEL','ADMIN_MAIL_REPLY') AND "actorType"='ADMIN' AND ("actorUserId" IS NOT NULL OR "actorNameSnapshot" IS NOT NULL))
        OR ("source"='SYSTEM_MIGRATION' AND "actorType"='SYSTEM')
      );
  END IF;
END $$;

-- Validaciones previas del estado legado. Si hay datos imposibles, aborta toda la transacción.
DO $$
DECLARE
  future_dates INTEGER;
  blank_emails INTEGER;
  idempotency_conflicts INTEGER;
BEGIN
  SELECT COUNT(*) INTO future_dates
  FROM "User"
  WHERE "bulkEmailOptOutAt" IS NOT NULL
    AND "bulkEmailOptOutAt" > CURRENT_TIMESTAMP + INTERVAL '5 minutes';

  SELECT COUNT(*) INTO blank_emails
  FROM "User"
  WHERE "bulkEmailOptOutAt" IS NOT NULL
    AND ("email" IS NULL OR btrim("email")='');

  SELECT COUNT(*) INTO idempotency_conflicts
  FROM "User" u
  JOIN "CommunicationPreferenceEvent" e
    ON e."idempotencyKey"='legacy-optout:' || u."id"
  WHERE u."bulkEmailOptOutAt" IS NOT NULL
    AND (
      e."userId"<>u."id"
      OR e."action"<>'LEGACY_OPT_OUT_SNAPSHOT'
      OR e."source"<>'SYSTEM_MIGRATION'
      OR e."actorType"<>'SYSTEM'
      OR e."previousOptOut" IS NOT NULL
      OR e."newOptOut" IS DISTINCT FROM TRUE
    );

  IF future_dates > 0 THEN
    RAISE EXCEPTION 'v7.10.6 abortada: % bajas tienen fecha futura', future_dates;
  END IF;
  IF blank_emails > 0 THEN
    RAISE EXCEPTION 'v7.10.6 abortada: % bajas no tienen email utilizable', blank_emails;
  END IF;
  IF idempotency_conflicts > 0 THEN
    RAISE EXCEPTION 'v7.10.6 abortada: % conflictos de idempotencyKey', idempotency_conflicts;
  END IF;
END $$;

-- Reconstruye únicamente el hecho comprobable: la cuenta YA estaba dada de baja.
-- No inventa actor, campaña, IP ni mensaje de origen.
INSERT INTO "CommunicationPreferenceEvent" (
  "id","userId","emailSnapshot","action","previousOptOut","newOptOut",
  "source","actorType","actorUserId","actorNameSnapshot","actorEmailSnapshot",
  "reasonCode","reasonText","communicationId","recipientId","idempotencyKey","metadata","createdAt"
)
SELECT
  'legacy-optout-' || md5(u."id"),
  u."id",
  u."email",
  'LEGACY_OPT_OUT_SNAPSHOT'::"CommunicationPreferenceAction",
  NULL,
  TRUE,
  'SYSTEM_MIGRATION'::"CommunicationPreferenceSource",
  'SYSTEM'::"CommunicationPreferenceActorType",
  NULL,NULL,NULL,
  COALESCE(NULLIF(btrim(u."bulkEmailOptOutReason"),''),'LEGACY_REASON_NOT_RECORDED'),
  NULL,NULL,NULL,
  'legacy-optout:' || u."id",
  jsonb_build_object(
    'migration','legacy-optout-backfill-v7.10.6',
    'legacyBulkEmailOptOutReason',u."bulkEmailOptOutReason",
    'reconstructedFromCurrentState',TRUE,
    'historicalActorKnown',FALSE,
    'historicalSourceVerified',FALSE
  ),
  u."bulkEmailOptOutAt"
FROM "User" u
WHERE u."bulkEmailOptOutAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "CommunicationPreferenceEvent" e
    WHERE e."idempotencyKey"='legacy-optout:' || u."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CommunicationPreferenceEvent" real_event
    WHERE real_event."userId"=u."id"
      AND real_event."action" IN ('OPT_OUT','OPT_IN')
  );

-- Control posterior: toda baja actual debe tener al menos historia reconstruida o historia real.
DO $$
DECLARE
  missing_history INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_history
  FROM "User" u
  WHERE u."bulkEmailOptOutAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "CommunicationPreferenceEvent" e
      WHERE e."userId"=u."id"
    );

  IF missing_history > 0 THEN
    RAISE EXCEPTION 'v7.10.6 abortada: % bajas actuales quedaron sin historial', missing_history;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_communication_preference_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CommunicationPreferenceEvent es append-only y no puede modificarse ni eliminarse';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "communication_preference_event_no_mutation" ON "CommunicationPreferenceEvent";
CREATE TRIGGER "communication_preference_event_no_mutation"
BEFORE UPDATE OR DELETE ON "CommunicationPreferenceEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_communication_preference_history_mutation();

COMMIT;
