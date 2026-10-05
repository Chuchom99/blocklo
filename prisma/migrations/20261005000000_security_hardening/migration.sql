-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('PENDING_WALLET', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."TransactionKind" AS ENUM ('TRANSFER', 'AIRTIME', 'DATA', 'BILL', 'INFLOW', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."PaymentIntentStatus" AS ENUM ('DRAFT', 'AUTHORIZED', 'EXECUTING', 'DONE', 'FAILED', 'EXPIRED', 'CANCELLED');

-- DropIndex
DROP INDEX "public"."Transaction_reference_idx";

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "bvnEnc" TEXT,
ADD COLUMN     "bvnHash" TEXT,
ADD COLUMN     "bvnLast4" TEXT,
ADD COLUMN     "ninEnc" TEXT,
ADD COLUMN     "ninHash" TEXT,
ADD COLUMN     "ninLast4" TEXT,
ADD COLUMN     "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "kycLevel" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."KYC" ADD COLUMN     "bvnEnc" TEXT,
ADD COLUMN     "bvnHash" TEXT,
ADD COLUMN     "ninEnc" TEXT,
ADD COLUMN     "ninHash" TEXT;

-- AlterTable
-- Hand-edited: backfill before constraints, and convert status in place instead of dropping it.
-- Rows with no reference get their id; duplicate references get the id appended.
UPDATE "public"."Transaction" SET "reference" = "id" WHERE "reference" IS NULL OR "reference" = '';
UPDATE "public"."Transaction" t SET "reference" = t."reference" || '-' || t."id"
WHERE EXISTS (
  SELECT 1 FROM "public"."Transaction" o
  WHERE o."reference" = t."reference" AND o."id" <> t."id" AND o."createdAt" <= t."createdAt"
);
-- Any status outside the new enum is treated as UNKNOWN so reconciliation picks it up.
UPDATE "public"."Transaction" SET "status" = 'UNKNOWN'
WHERE "status" NOT IN ('PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'REVERSED');

ALTER TABLE "public"."Transaction" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "public"."Transaction" ADD COLUMN     "destinationBankCode" TEXT,
ADD COLUMN     "intentId" TEXT,
ADD COLUMN     "kind" "public"."TransactionKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "lastRequeryAt" TIMESTAMP(3),
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "requeryCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "reference" SET NOT NULL,
ALTER COLUMN "status" SET DATA TYPE "public"."TransactionStatus" USING "status"::"public"."TransactionStatus",
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "balanceAfter" SET DATA TYPE DECIMAL(18,2);

-- CreateTable
CREATE TABLE "public"."PaymentIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "public"."TransactionKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "public"."PaymentIntentStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "public"."PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentIntent_userId_status_idx" ON "public"."PaymentIntent"("userId", "status");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "public"."PaymentIntent"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshHash_key" ON "public"."Session"("refreshHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "public"."Session"("familyId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "public"."AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_bvnHash_key" ON "public"."User"("bvnHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_ninHash_key" ON "public"."User"("ninHash");

-- CreateIndex
CREATE UNIQUE INDEX "KYC_bvnHash_key" ON "public"."KYC"("bvnHash");

-- CreateIndex
CREATE UNIQUE INDEX "KYC_ninHash_key" ON "public"."KYC"("ninHash");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "public"."Transaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_intentId_key" ON "public"."Transaction"("intentId");

-- CreateIndex
CREATE INDEX "Transaction_status_createdAt_idx" ON "public"."Transaction"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "public"."PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentIntent" ADD CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentIntent" ADD CONSTRAINT "PaymentIntent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-edited: canonicalise WhatsApp ids to digits only (e.g. +2348012345678 -> 2348012345678).
UPDATE "public"."User" SET "whatsappId" = regexp_replace("whatsappId", '\D', '', 'g')
WHERE "whatsappId" IS NOT NULL AND "whatsappId" ~ '\D'
  -- skip rows whose canonical id already belongs to another user; resolve those manually
  AND NOT EXISTS (
    SELECT 1 FROM "public"."User" u2
    WHERE u2."whatsappId" = regexp_replace("public"."User"."whatsappId", '\D', '', 'g')
  );
