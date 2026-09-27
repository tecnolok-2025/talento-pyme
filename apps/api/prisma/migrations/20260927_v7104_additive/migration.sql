-- Talento PyME v7.10.4
-- Migración deliberadamente ADITIVA e IDEMPOTENTE desde v7.9.16.
-- No elimina, renombra ni transforma columnas existentes.

ALTER TABLE "CandidateBolsa"
  ADD COLUMN IF NOT EXISTS "fechaNacimiento" TEXT,
  ADD COLUMN IF NOT EXISTS "telefonoAdicional" TEXT;

CREATE TABLE IF NOT EXISTS "CandidateClassification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "classificationVersion" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "classKey" TEXT NOT NULL,
  "classLabel" TEXT NOT NULL,
  "expertiseKey" TEXT NOT NULL,
  "expertiseLabel" TEXT NOT NULL,
  "expertiseSource" TEXT,
  "profileTitle" TEXT NOT NULL,
  "recentRole" TEXT,
  "profileScore" INTEGER,
  "seniorityKey" TEXT NOT NULL,
  "seniorityLabel" TEXT NOT NULL,
  "explicitYearsExperience" DOUBLE PRECISION,
  "relevantYearsExperience" DOUBLE PRECISION,
  "experienceEvidenceSource" TEXT,
  "professionalSourcesUsed" JSONB,
  "cvEvidenceUsed" BOOLEAN NOT NULL DEFAULT false,
  "classificationConfidence" TEXT,
  "reason" TEXT,
  "scoreBasis" TEXT,
  "evidence" JSONB,
  "gaps" JSONB,
  "assessment" TEXT,
  "searchText" TEXT,
  "triggerSource" TEXT,
  "sourceUpdatedAt" TIMESTAMP(3),
  "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CandidateClassification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CandidateClassification_userId_key"
  ON "CandidateClassification"("userId");
CREATE INDEX IF NOT EXISTS "CandidateClassification_classificationVersion_idx"
  ON "CandidateClassification"("classificationVersion");
CREATE INDEX IF NOT EXISTS "CandidateClassification_classKey_idx"
  ON "CandidateClassification"("classKey");
CREATE INDEX IF NOT EXISTS "CandidateClassification_expertiseKey_idx"
  ON "CandidateClassification"("expertiseKey");
CREATE INDEX IF NOT EXISTS "CandidateClassification_seniorityKey_idx"
  ON "CandidateClassification"("seniorityKey");
CREATE INDEX IF NOT EXISTS "CandidateClassification_classifiedAt_idx"
  ON "CandidateClassification"("classifiedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CandidateClassification_userId_fkey' AND conrelid = '"CandidateClassification"'::regclass
  ) THEN
    ALTER TABLE "CandidateClassification"
      ADD CONSTRAINT "CandidateClassification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
