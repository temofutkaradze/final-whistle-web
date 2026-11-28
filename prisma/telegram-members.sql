-- Additive opt-in migration. Requires separate approval; never run automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE "public"."TelegramMember" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "principalId" TEXT NOT NULL UNIQUE REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "telegramUserId" VARCHAR(16) NOT NULL CHECK ("telegramUserId" ~ '^[1-9][0-9]{0,15}$' AND "telegramUserId"::numeric <= 9007199254740991),
  "displayName" VARCHAR(80),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','SUSPENDED','REVOKED')),
  "matchAccess" BOOLEAN NOT NULL DEFAULT false,
  "newsAccess" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("ownerId", "telegramUserId"),
  CHECK ("ownerId" <> "principalId")
);
COMMIT;
