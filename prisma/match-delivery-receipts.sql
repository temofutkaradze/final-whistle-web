-- Additive preparation only. Do not apply to Neon without separate approval.
-- Terminal receipt rows protect duplicate prevention after Match/Selection pruning.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "public"."MatchDeliveryReceipt" (
  "userId" TEXT NOT NULL,
  "fixtureId" INTEGER NOT NULL,
  "finalStatus" TEXT NOT NULL,
  "finalSentAt" TIMESTAMP(3),
  "finalDispatchAt" TIMESTAMP(3),
  "liveStatus" TEXT NOT NULL,
  "liveSentAt" TIMESTAMP(3),
  "liveDispatchAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchDeliveryReceipt_pkey" PRIMARY KEY ("userId", "fixtureId"),
  CONSTRAINT "MatchDeliveryReceipt_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchDeliveryReceipt_finalStatus_check" CHECK ("finalStatus" IN ('COMPLETED', 'FAILED', 'DESELECTED')),
  CONSTRAINT "MatchDeliveryReceipt_liveStatus_check" CHECK ("liveStatus" IN ('PENDING', 'SENT', 'FAILED')),
  CONSTRAINT "MatchDeliveryReceipt_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE INDEX "MatchDeliveryReceipt_expiresAt_idx" ON "public"."MatchDeliveryReceipt"("expiresAt");
COMMIT;
