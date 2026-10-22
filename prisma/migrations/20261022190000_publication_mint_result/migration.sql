-- CreateEnum
CREATE TYPE "PublicationMintResultStatus" AS ENUM ('VERIFIED', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_RESULT_CHECKED';

-- CreateTable
CREATE TABLE "PublicationMintResult" (
    "attemptId" UUID NOT NULL,
    "status" "PublicationMintResultStatus" NOT NULL,
    "checkedObservationId" UUID NOT NULL,
    "verifiedObservationId" UUID,
    "verificationStatus" "PublicationMintObservationStatus",

    CONSTRAINT "PublicationMintResult_pkey" PRIMARY KEY ("attemptId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintResult_checkedObservationId_key" ON "PublicationMintResult"("checkedObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintResult_verifiedObservationId_key" ON "PublicationMintResult"("verifiedObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintResult_checkedObservationId_attemptId_key" ON "PublicationMintResult"("checkedObservationId", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintResult_verifiedObservationId_attemptId_verif_key" ON "PublicationMintResult"("verifiedObservationId", "attemptId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintObservation_id_attemptId_key" ON "PublicationMintObservation"("id", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintObservation_id_attemptId_status_key" ON "PublicationMintObservation"("id", "attemptId", "status");

-- AddForeignKey
ALTER TABLE "PublicationMintResult" ADD CONSTRAINT "PublicationMintResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintResult" ADD CONSTRAINT "PublicationMintResult_checkedObservationId_attemptId_fkey" FOREIGN KEY ("checkedObservationId", "attemptId") REFERENCES "PublicationMintObservation"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintResult" ADD CONSTRAINT "PublicationMintResult_verifiedObservationId_attemptId_veri_fkey" FOREIGN KEY ("verifiedObservationId", "attemptId", "verificationStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Verification must reference a VERIFIED observation belonging to this attempt.
-- Suspended projections may retain their previous proof; no history is rewritten.
ALTER TABLE "PublicationMintResult" ADD CONSTRAINT "PublicationMintResult_state_check" CHECK (
  (("verifiedObservationId" IS NULL AND "verificationStatus" IS NULL)
    OR ("verifiedObservationId" IS NOT NULL AND "verificationStatus" = 'VERIFIED')) IS TRUE
  AND ("status" <> 'VERIFIED' OR
    ("verifiedObservationId" IS NOT NULL AND "checkedObservationId" = "verifiedObservationId"))
);
