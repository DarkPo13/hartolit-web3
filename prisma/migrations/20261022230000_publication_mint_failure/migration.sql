-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_FAILED';

-- AlterEnum
ALTER TYPE "PublicationMintAttemptStatus" ADD VALUE 'FAILED_TERMINAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PublicationStatus" ADD VALUE 'CHAIN_FAILED';
ALTER TYPE "PublicationStatus" ADD VALUE 'CHAIN_FAILED_SUSPENDED';

-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failedObservationId" UUID,
ADD COLUMN     "failureStatus" "PublicationMintObservationStatus";

-- CreateTable
CREATE TABLE "PublicationMintFailure" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "observationId" UUID NOT NULL,
    "proofStatus" "PublicationMintObservationStatus" NOT NULL DEFAULT 'REVERTED',
    "transactionId" UUID NOT NULL,
    "reviewedObservationVersion" INTEGER NOT NULL,
    "intentSha256" CHAR(64) NOT NULL,
    "walletStateSha256" CHAR(64) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintFailure_attemptId_key" ON "PublicationMintFailure"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintFailure_requestId_key" ON "PublicationMintFailure"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintFailure_observationId_key" ON "PublicationMintFailure"("observationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintFailure_observationId_attemptId_transactionI_key" ON "PublicationMintFailure"("observationId", "attemptId", "transactionId", "proofStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_failedObservationId_key" ON "PublicationMintAttempt"("failedObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_failedObservationId_id_failureStatus_key" ON "PublicationMintAttempt"("failedObservationId", "id", "failureStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintObservation_failure_binding_key" ON "PublicationMintObservation"("id", "attemptId", "transactionId", "status");

-- AddForeignKey
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_failure_proof_fkey" FOREIGN KEY ("failedObservationId", "id", "failureStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "PublicationMintFailure" ADD CONSTRAINT "PublicationMintFailure_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintFailure" ADD CONSTRAINT "PublicationMintFailure_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintFailure" ADD CONSTRAINT "PublicationMintFailure_proof_fkey" FOREIGN KEY ("observationId", "attemptId", "transactionId", "proofStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "transactionId", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationMintAttempt" DROP CONSTRAINT "PublicationMintAttempt_shape_check";
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_shape_check" CHECK (
  ("chainId" = 97 AND "publisherWallet" ~ '^0x[0-9a-f]{40}$' AND "publisherWallet" <> '0x0000000000000000000000000000000000000000'
  AND "nonce" BETWEEN 0 AND 9007199254740991 AND "deadlineAt" > "createdAt"
  AND ("unknownAt" IS NULL OR "unknownAt" >= "createdAt")
  AND (("status" = 'DISPATCHING' AND "unknownAt" IS NULL) OR ("status" = 'UNKNOWN' AND "unknownAt" IS NOT NULL)
    OR "status" IN ('FINALIZED', 'FAILED_TERMINAL'))
  AND (("status" = 'FINALIZED' AND "finalizedAt" IS NOT NULL AND "finalizedAt" >= "createdAt"
    AND "finalizedObservationId" IS NOT NULL AND "finalizationStatus" = 'VERIFIED')
    OR ("status" <> 'FINALIZED' AND "finalizedAt" IS NULL AND "finalizedObservationId" IS NULL AND "finalizationStatus" IS NULL))
  AND (("status" = 'FAILED_TERMINAL' AND "failedAt" IS NOT NULL AND "failedAt" >= "createdAt"
    AND "failedObservationId" IS NOT NULL AND "failureStatus" = 'REVERTED')
    OR ("status" <> 'FAILED_TERMINAL' AND "failedAt" IS NULL AND "failedObservationId" IS NULL AND "failureStatus" IS NULL))
  AND ("quarantinedAt" IS NULL OR ("status" IN ('FINALIZED', 'FAILED_TERMINAL')
    AND "quarantinedAt" >= COALESCE("finalizedAt", "failedAt")))) IS TRUE
);

DROP INDEX "PublicationMintAttempt_one_active_per_wallet";
CREATE UNIQUE INDEX "PublicationMintAttempt_one_active_per_wallet"
ON "PublicationMintAttempt" ("chainId", "publisherWallet") WHERE "status" NOT IN ('FINALIZED', 'FAILED_TERMINAL');

ALTER TABLE "PublicationMintFailure" ADD CONSTRAINT "PublicationMintFailure_shape_check" CHECK (
  ("proofStatus" = 'REVERTED' AND "reviewedObservationVersion" >= 0 AND isfinite("closedAt")
   AND "intentSha256" ~ '^[0-9a-f]{64}$' AND "walletStateSha256" ~ '^[0-9a-f]{64}$') IS TRUE
);
