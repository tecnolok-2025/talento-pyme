CREATE TABLE IF NOT EXISTS "RegistrationAuditEvent" (
    "id" TEXT NOT NULL,
    "role" TEXT,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RegistrationAuditEvent_role_createdAt_idx" ON "RegistrationAuditEvent"("role", "createdAt");
CREATE INDEX IF NOT EXISTS "RegistrationAuditEvent_eventType_createdAt_idx" ON "RegistrationAuditEvent"("eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "RegistrationAuditEvent_outcome_createdAt_idx" ON "RegistrationAuditEvent"("outcome", "createdAt");
