-- CreateEnum
CREATE TYPE "PublicationMintRecoveryKind" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_FAILURE_RESTORED';

-- AlterTable
ALTER TABLE "PublicationMintRecovery" ADD COLUMN     "failedObservationId" UUID,
ADD COLUMN     "kind" "PublicationMintRecoveryKind" NOT NULL DEFAULT 'SUCCESS',
ALTER COLUMN "finalizedObservationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_failed_original_fkey" FOREIGN KEY ("failedObservationId", "attemptId", "verificationStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing rows retain SUCCESS/VERIFIED and their original proof pointers.
-- Failure recovery may only validate REVERTED; it cannot manufacture success.
ALTER TABLE "PublicationMintRecovery" DROP CONSTRAINT "PublicationMintRecovery_shape_check";
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_shape_check" CHECK (
  ("reviewedObservationVersion" > 0 AND "intentSha256" ~ '^[0-9a-f]{64}$' AND "walletStateSha256" ~ '^[0-9a-f]{64}$'
   AND isfinite("quarantinedAt") AND isfinite("restoredAt") AND "restoredAt" >= "quarantinedAt"
   AND (("kind" = 'SUCCESS' AND "verificationStatus" = 'VERIFIED' AND "failedObservationId" IS NULL
         AND "finalizedObservationId" IS NOT NULL AND "finalizedObservationId" <> "verifiedObservationId")
     OR ("kind" = 'FAILURE' AND "verificationStatus" = 'REVERTED' AND "finalizedObservationId" IS NULL
         AND "failedObservationId" IS NOT NULL AND "failedObservationId" <> "verifiedObservationId"))) IS TRUE
);
