-- H1 PREPARATION ONLY. Do not execute without separate migration/rollout approval.
-- Generated from local schema files, then schema-qualified and bounded transactionally.
-- Assumes the verified deployment uses public.User; stop on any schema mismatch.
-- No IF NOT EXISTS: an existing AuthIdentity requires inspection, not silent reuse.
-- No existing User, password, session or application-data rows are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- CreateTable
CREATE TABLE "public"."AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "public"."AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "public"."AuthIdentity"("userId", "provider");

-- AddForeignKey
ALTER TABLE "public"."AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AuthIdentity"
  ADD CONSTRAINT "AuthIdentity_provider_check" CHECK ("provider" = 'google'),
  ADD CONSTRAINT "AuthIdentity_subject_check" CHECK (char_length("subject") BETWEEN 1 AND 255);

COMMIT;
