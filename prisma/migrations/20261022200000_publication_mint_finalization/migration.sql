-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_FINALIZED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_QUARANTINED';

-- AlterEnum
ALTER TYPE "PublicationMintAttemptStatus" ADD VALUE 'FINALIZED';

-- AlterEnum
ALTER TYPE "PublicationStatus" ADD VALUE 'CHAIN_SUSPENDED';

-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "finalizationStatus" "PublicationMintObservationStatus",
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedObservationId" UUID,
ADD COLUMN     "quarantinedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_finalizedObservationId_key" ON "PublicationMintAttempt"("finalizedObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_finalizedObservationId_id_finalizati_key" ON "PublicationMintAttempt"("finalizedObservationId", "id", "finalizationStatus");

-- AddForeignKey
-- Deferred to permit atomic cleanup of fictional attempt/observation cycles.
-- It remains mandatory at commit; business records have no deletion path.
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_finalizedObservationId_id_finalizat_fkey" FOREIGN KEY ("finalizedObservationId", "id", "finalizationStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "PublicationMintAttempt" DROP CONSTRAINT "PublicationMintAttempt_shape_check";
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_shape_check" CHECK (
  ("chainId" = 97 AND "publisherWallet" ~ '^0x[0-9a-f]{40}$' AND "publisherWallet" <> '0x0000000000000000000000000000000000000000'
  AND "nonce" >= 0 AND "nonce" <= 9007199254740991 AND "deadlineAt" > "createdAt"
  AND ("unknownAt" IS NULL OR "unknownAt" >= "createdAt")
  AND (("status" = 'DISPATCHING' AND "unknownAt" IS NULL)
    OR ("status" = 'UNKNOWN' AND "unknownAt" IS NOT NULL) OR "status" = 'FINALIZED')
  AND (("status" = 'FINALIZED' AND "finalizedAt" IS NOT NULL AND "finalizedAt" >= "createdAt"
    AND "finalizedObservationId" IS NOT NULL AND "finalizationStatus" = 'VERIFIED')
    OR ("status" <> 'FINALIZED' AND "finalizedAt" IS NULL AND "finalizedObservationId" IS NULL AND "finalizationStatus" IS NULL))
  AND ("quarantinedAt" IS NULL OR ("status" = 'FINALIZED' AND "quarantinedAt" >= "finalizedAt"))) IS TRUE
);

-- Quarantine is independent of the active slot: a later attempt may already own it.
DROP INDEX "PublicationMintAttempt_one_active_per_wallet";
CREATE UNIQUE INDEX "PublicationMintAttempt_one_active_per_wallet"
ON "PublicationMintAttempt" ("chainId", "publisherWallet") WHERE "status" <> 'FINALIZED';

ALTER TABLE "Publication" ADD CONSTRAINT "Publication_finalized_chain_check" CHECK (
  (("status" IN ('PUBLISHED', 'CHAIN_SUSPENDED') AND "chainId" = 97
    AND "contractAddress" ~ '^0x[0-9a-f]{40}$' AND "contractAddress" <> '0x0000000000000000000000000000000000000000'
    AND "transactionHash" ~ '^0x[0-9a-f]{64}$' AND "tokenId" ~ '^[1-9][0-9]{0,77}$' AND "ipfsCid" IS NOT NULL)
    OR ("status" NOT IN ('PUBLISHED', 'CHAIN_SUSPENDED') AND "contractAddress" IS NULL AND "transactionHash" IS NULL AND "tokenId" IS NULL)) IS TRUE
);
