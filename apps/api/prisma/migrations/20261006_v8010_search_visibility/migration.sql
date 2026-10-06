-- v8.0.10 · visibilidad administrable en búsquedas
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hiddenFromSearch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "hiddenFromSearch" BOOLEAN NOT NULL DEFAULT false;
