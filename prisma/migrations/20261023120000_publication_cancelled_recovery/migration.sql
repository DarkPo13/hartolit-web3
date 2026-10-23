SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- AlterEnum
ALTER TYPE "PublicationMintRecoveryKind" ADD VALUE 'CANCELLATION';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_CANCELLATION_RESTORED';

-- AlterTable
ALTER TABLE "PublicationMintRecovery" ADD COLUMN     "cancellationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintCancellation_id_attemptId_observationId_key" ON "PublicationMintCancellation"("id", "attemptId", "observationId");

-- CreateIndex
CREATE INDEX "PublicationMintRecovery_cancellationId_idx" ON "PublicationMintRecovery"("cancellationId");

-- AddForeignKey
-- A cancellation recovery's original proof is exactly its reviewed closure proof.
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_cancellation_fkey" FOREIGN KEY ("cancellationId", "attemptId", "failedObservationId") REFERENCES "PublicationMintCancellation"("id", "attemptId", "observationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing SUCCESS/FAILURE rows have no cancellation pointer and keep their meaning.
ALTER TABLE "PublicationMintRecovery" DROP CONSTRAINT "PublicationMintRecovery_shape_check";
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_shape_check" CHECK (
  ("reviewedObservationVersion" > 0 AND "intentSha256" ~ '^[0-9a-f]{64}$' AND "walletStateSha256" ~ '^[0-9a-f]{64}$'
   AND isfinite("quarantinedAt") AND isfinite("restoredAt") AND "restoredAt" >= "quarantinedAt"
   AND (("kind" = 'SUCCESS' AND "verificationStatus" = 'VERIFIED' AND "failedObservationId" IS NULL AND "cancellationId" IS NULL
         AND "finalizedObservationId" IS NOT NULL AND "finalizedObservationId" <> "verifiedObservationId")
     OR ("kind" = 'FAILURE' AND "verificationStatus" = 'REVERTED' AND "finalizedObservationId" IS NULL AND "cancellationId" IS NULL
         AND "failedObservationId" IS NOT NULL AND "failedObservationId" <> "verifiedObservationId")
     OR ("kind" = 'CANCELLATION' AND "verificationStatus" = 'CANCELLED' AND "finalizedObservationId" IS NULL AND "cancellationId" IS NOT NULL
         AND "failedObservationId" IS NOT NULL AND "failedObservationId" <> "verifiedObservationId"))) IS TRUE
) NOT VALID;
ALTER TABLE "PublicationMintRecovery" VALIDATE CONSTRAINT "PublicationMintRecovery_shape_check";
RESET lock_timeout;
RESET statement_timeout;
