-- CreateEnum
CREATE TYPE "PublicationMintAttemptStatus" AS ENUM ('DISPATCHING', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_DISPATCH_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_OUTCOME_UNKNOWN';

-- CreateTable
CREATE TABLE "PublicationMintAttempt" (
    "id" UUID NOT NULL,
    "preparationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "publisherWallet" VARCHAR(42) NOT NULL,
    "nonce" BIGINT NOT NULL,
    "status" "PublicationMintAttemptStatus" NOT NULL DEFAULT 'DISPATCHING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "unknownAt" TIMESTAMP(3),

    CONSTRAINT "PublicationMintAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_preparationId_key" ON "PublicationMintAttempt"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_requestId_key" ON "PublicationMintAttempt"("requestId");

-- CreateIndex
CREATE INDEX "PublicationMintAttempt_status_deadlineAt_idx" ON "PublicationMintAttempt"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_chainId_publisherWallet_nonce_key" ON "PublicationMintAttempt"("chainId", "publisherWallet", "nonce");

-- AddForeignKey
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "PublicationMintPreparation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Different passport locks cannot protect a shared wallet. Keep its slot occupied
-- even without a hash and after expiry; only future positive reconciliation can close it.
CREATE UNIQUE INDEX "PublicationMintAttempt_one_active_per_wallet"
ON "PublicationMintAttempt" ("chainId", "publisherWallet") WHERE "status" IN ('DISPATCHING', 'UNKNOWN');

ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_shape_check" CHECK (
  "chainId" = 97 AND "publisherWallet" ~ '^0x[0-9a-f]{40}$' AND "publisherWallet" <> '0x0000000000000000000000000000000000000000'
  AND "nonce" >= 0 AND "nonce" <= 9007199254740991 AND "deadlineAt" > "createdAt"
  AND (("status" = 'DISPATCHING' AND "unknownAt" IS NULL)
    OR ("status" = 'UNKNOWN' AND "unknownAt" IS NOT NULL AND "unknownAt" >= "createdAt"))
);
