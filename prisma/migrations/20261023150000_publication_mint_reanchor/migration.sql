SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_REANCHORED';

-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "anchorObservationId" UUID;

-- CreateTable
CREATE TABLE "PublicationMintReanchor" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "quarantinedAt" TIMESTAMP(3) NOT NULL,
    "reviewedObservationVersion" INTEGER NOT NULL,
    "intentSha256" CHAR(64) NOT NULL,
    "walletStateSha256" CHAR(64) NOT NULL,
    "transactionHash" VARCHAR(66) NOT NULL,
    "proofStatus" "PublicationMintObservationStatus" NOT NULL,
    "finalizedObservationId" UUID,
    "failedObservationId" UUID,
    "previousAnchorObservationId" UUID,
    "anchorObservationId" UUID NOT NULL,
    "reanchoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintReanchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReanchor_requestId_key" ON "PublicationMintReanchor"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReanchor_anchorObservationId_key" ON "PublicationMintReanchor"("anchorObservationId");

-- CreateIndex
CREATE INDEX "PublicationMintReanchor_attemptId_reanchoredAt_idx" ON "PublicationMintReanchor"("attemptId", "reanchoredAt");

-- CreateIndex
CREATE INDEX "PublicationMintReanchor_actorId_idx" ON "PublicationMintReanchor"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReanchor_attemptId_anchorObservationId_key" ON "PublicationMintReanchor"("attemptId", "anchorObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReanchor_attemptId_reviewedObservationVersio_key" ON "PublicationMintReanchor"("attemptId", "reviewedObservationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_id_anchorObservationId_key" ON "PublicationMintAttempt"("id", "anchorObservationId");

-- AddForeignKey
-- Deferred like the first-proof FKs so owned fictional cycles can be removed
-- atomically; it remains mandatory at commit and business rows have no delete path.
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_anchor_fkey" FOREIGN KEY ("id", "anchorObservationId") REFERENCES "PublicationMintReanchor"("attemptId", "anchorObservationId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_first_success_fkey" FOREIGN KEY ("finalizedObservationId", "attemptId", "proofStatus") REFERENCES "PublicationMintAttempt"("finalizedObservationId", "id", "finalizationStatus") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_first_failure_fkey" FOREIGN KEY ("failedObservationId", "attemptId", "proofStatus") REFERENCES "PublicationMintAttempt"("failedObservationId", "id", "failureStatus") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_first_success_proof_fkey" FOREIGN KEY ("finalizedObservationId", "attemptId", "transactionHash", "proofStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "reportedHash", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_first_failure_proof_fkey" FOREIGN KEY ("failedObservationId", "attemptId", "transactionHash", "proofStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "reportedHash", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_previous_fkey" FOREIGN KEY ("attemptId", "previousAnchorObservationId") REFERENCES "PublicationMintReanchor"("attemptId", "anchorObservationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_anchor_proof_fkey" FOREIGN KEY ("anchorObservationId", "attemptId", "transactionHash", "proofStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "reportedHash", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The re-included proof keeps the first proof's attempt, hash and outcome
-- (enforced by the composite FKs above); it never replaces the first proof.
ALTER TABLE "PublicationMintReanchor" ADD CONSTRAINT "PublicationMintReanchor_shape_check" CHECK (
  ("reviewedObservationVersion" > 0 AND "intentSha256" ~ '^[0-9a-f]{64}$' AND "walletStateSha256" ~ '^[0-9a-f]{64}$'
   AND "transactionHash" ~ '^0x[0-9a-f]{64}$' AND isfinite("quarantinedAt") AND isfinite("reanchoredAt")
   AND "reanchoredAt" >= "quarantinedAt"
   AND (("proofStatus" = 'VERIFIED' AND "finalizedObservationId" IS NOT NULL AND "failedObservationId" IS NULL
         AND "anchorObservationId" <> "finalizedObservationId")
     OR ("proofStatus" IN ('REVERTED', 'CANCELLED') AND "failedObservationId" IS NOT NULL AND "finalizedObservationId" IS NULL
         AND "anchorObservationId" <> "failedObservationId"))
   AND ("previousAnchorObservationId" IS NULL OR "previousAnchorObservationId" <> "anchorObservationId")) IS TRUE
);

ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_anchor_check" CHECK (
  ("anchorObservationId" IS NULL OR ("status" IN ('FINALIZED', 'FAILED_TERMINAL')
    AND "anchorObservationId" <> COALESCE("finalizedObservationId", "failedObservationId"))) IS TRUE
) NOT VALID;
ALTER TABLE "PublicationMintAttempt" VALIDATE CONSTRAINT "PublicationMintAttempt_anchor_check";
RESET lock_timeout;
RESET statement_timeout;
