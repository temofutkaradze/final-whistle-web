-- Development preparation only. DO NOT apply without explicit database migration approval.
-- Additive PostgreSQL migration, following this repository's reviewed SQL migration convention.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "public"."Match"
  ADD COLUMN "elapsedMinutes" INTEGER,
  ADD COLUMN "extraMinutes" INTEGER,
  ADD COLUMN "liveCheckpointAt" TIMESTAMP(3),
  ADD COLUMN "liveCheckpointJson" JSONB;
ALTER TABLE "public"."Selection"
  ADD COLUMN "selectedAt" TIMESTAMP(3),
  ADD COLUMN "liveStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "liveAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "liveUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "liveLastError" TEXT,
  ADD COLUMN "liveSentAt" TIMESTAMP(3),
  ADD COLUMN "liveDispatchAt" TIMESTAMP(3),
  ADD COLUMN "finalDispatchAt" TIMESTAMP(3);
-- Existing selections retain their actual selection time, not migration time.
UPDATE "public"."Selection" SET "selectedAt" = "createdAt";
ALTER TABLE "public"."Selection" ALTER COLUMN "selectedAt" SET NOT NULL,
  ALTER COLUMN "selectedAt" SET DEFAULT CURRENT_TIMESTAMP;
COMMIT;
