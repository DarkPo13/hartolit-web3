-- CreateEnum
CREATE TYPE "PublicationPinAttemptStatus" AS ENUM ('PREPARED', 'DISPATCHING', 'UNKNOWN', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_PIN_PREPARED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_PIN_DISPATCH_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_PIN_OUTCOME_UNKNOWN';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_PIN_CANCELLED';

-- CreateTable
CREATE TABLE "PublicationPinAttempt" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "walletChallengeId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" "PublicationPinAttemptStatus" NOT NULL DEFAULT 'PREPARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationPinAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationPinAttempt_requestId_key" ON "PublicationPinAttempt"("requestId");

-- CreateIndex
CREATE INDEX "PublicationPinAttempt_publicationId_createdAt_idx" ON "PublicationPinAttempt"("publicationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PublicationPinAttempt_status_deadlineAt_idx" ON "PublicationPinAttempt"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationWalletChallenge_id_publicationId_key" ON "PublicationWalletChallenge"("id", "publicationId");

-- AddForeignKey
ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_walletChallengeId_publicationId_fkey" FOREIGN KEY ("walletChallengeId", "publicationId") REFERENCES "PublicationWalletChallenge"("id", "publicationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A crash is never evidence that an external provider did nothing. UNKNOWN remains active.
CREATE UNIQUE INDEX "PublicationPinAttempt_one_active_per_publication"
ON "PublicationPinAttempt" ("publicationId") WHERE "status" <> 'CANCELLED';

ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_timestamps_check" CHECK (
  ("status" = 'PREPARED' AND "dispatchedAt" IS NULL AND "deadlineAt" IS NULL AND "closedAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "dispatchedAt" IS NULL AND "deadlineAt" IS NULL AND "closedAt" IS NOT NULL)
  OR ("status" = 'DISPATCHING' AND "dispatchedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL AND "deadlineAt" > "dispatchedAt" AND "closedAt" IS NULL)
  OR ("status" = 'UNKNOWN' AND "dispatchedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL AND "deadlineAt" > "dispatchedAt" AND "closedAt" IS NOT NULL)
);
