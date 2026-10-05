ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'APP';
ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SupportMessage_externalRef_key" ON "SupportMessage"("externalRef");
CREATE INDEX IF NOT EXISTS "SupportMessage_source_createdAt_idx" ON "SupportMessage"("source", "createdAt");

CREATE TABLE IF NOT EXISTS "InboundMailMessage" (
  "id" TEXT NOT NULL,
  "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
  "uid" INTEGER NOT NULL,
  "messageId" TEXT,
  "fromAddress" TEXT,
  "fromName" TEXT,
  "subject" TEXT,
  "bodyText" TEXT,
  "receivedAt" TIMESTAMP(3),
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "consultationStatus" TEXT,
  "matchedUserId" TEXT,
  "matchedRole" TEXT,
  "supportThreadId" TEXT,
  "bounceTargetEmail" TEXT,
  "hiddenFromTraceability" BOOLEAN NOT NULL DEFAULT false,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundMailMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InboundMailMessage_mailbox_uid_key" ON "InboundMailMessage"("mailbox", "uid");
CREATE INDEX IF NOT EXISTS "InboundMailMessage_category_receivedAt_idx" ON "InboundMailMessage"("category", "receivedAt");
CREATE INDEX IF NOT EXISTS "InboundMailMessage_matchedUserId_receivedAt_idx" ON "InboundMailMessage"("matchedUserId", "receivedAt");
CREATE INDEX IF NOT EXISTS "InboundMailMessage_supportThreadId_receivedAt_idx" ON "InboundMailMessage"("supportThreadId", "receivedAt");

CREATE TABLE IF NOT EXISTS "EmailSuppression" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "sourceInboundMailId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailSuppression_email_key" ON "EmailSuppression"("email");
CREATE INDEX IF NOT EXISTS "EmailSuppression_active_updatedAt_idx" ON "EmailSuppression"("active", "updatedAt");
