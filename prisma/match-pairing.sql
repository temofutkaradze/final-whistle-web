-- H2 preparation only. Separate migration and activation approval required.
-- Offline schema diff; public.User and table absence must be verified before execution.
-- Creates two empty tables only: no legacy approval, user updates or selections changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- CreateTable
CREATE TABLE "public"."MatchPairingChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "connectionHash" CHAR(64) NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPairingChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MatchTelegramBinding" (
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTelegramBinding_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchPairingChallenge_codeHash_key" ON "public"."MatchPairingChallenge"("codeHash");

-- CreateIndex
CREATE INDEX "MatchPairingChallenge_userId_expiresAt_idx" ON "public"."MatchPairingChallenge"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPairingChallenge_userId_botId_telegramUserId_key" ON "public"."MatchPairingChallenge"("userId", "botId", "telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchTelegramBinding_botId_key" ON "public"."MatchTelegramBinding"("botId");

-- AddForeignKey
ALTER TABLE "public"."MatchPairingChallenge" ADD CONSTRAINT "MatchPairingChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MatchTelegramBinding" ADD CONSTRAINT "MatchTelegramBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MatchPairingChallenge"
 ADD CONSTRAINT "MatchPairingChallenge_private_identity_check" CHECK ("telegramUserId" = "chatId" AND "chatId" ~ '^[1-9][0-9]{0,15}$'),
 ADD CONSTRAINT "MatchPairingChallenge_hash_check" CHECK ("codeHash" ~ '^[a-f0-9]{64}$' AND "connectionHash" ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT "MatchPairingChallenge_expiry_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "public"."MatchTelegramBinding"
 ADD CONSTRAINT "MatchTelegramBinding_private_identity_check" CHECK ("telegramUserId" = "chatId" AND "chatId" ~ '^[1-9][0-9]{0,15}$');
COMMIT;
