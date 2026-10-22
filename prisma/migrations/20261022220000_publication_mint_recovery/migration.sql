-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_RESTORED';

-- CreateTable
CREATE TABLE "PublicationMintRecovery" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "quarantinedAt" TIMESTAMP(3) NOT NULL,
    "reviewedObservationVersion" INTEGER NOT NULL,
    "intentSha256" CHAR(64) NOT NULL,
    "walletStateSha256" CHAR(64) NOT NULL,
    "finalizedObservationId" UUID NOT NULL,
    "verifiedObservationId" UUID NOT NULL,
    "verificationStatus" "PublicationMintObservationStatus" NOT NULL DEFAULT 'VERIFIED',
    "restoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintRecovery_requestId_key" ON "PublicationMintRecovery"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintRecovery_verifiedObservationId_key" ON "PublicationMintRecovery"("verifiedObservationId");

-- CreateIndex
CREATE INDEX "PublicationMintRecovery_attemptId_restoredAt_idx" ON "PublicationMintRecovery"("attemptId", "restoredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintRecovery_attemptId_reviewedObservationVersio_key" ON "PublicationMintRecovery"("attemptId", "reviewedObservationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintRecovery_verifiedObservationId_attemptId_ver_key" ON "PublicationMintRecovery"("verifiedObservationId", "attemptId", "verificationStatus");

-- AddForeignKey
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_finalizedObservationId_attemptId_v_fkey" FOREIGN KEY ("finalizedObservationId", "attemptId", "verificationStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_verifiedObservationId_attemptId_ve_fkey" FOREIGN KEY ("verifiedObservationId", "attemptId", "verificationStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationMintRecovery" ADD CONSTRAINT "PublicationMintRecovery_shape_check" CHECK (
  ("verificationStatus" = 'VERIFIED' AND "reviewedObservationVersion" > 0
   AND "intentSha256" ~ '^[0-9a-f]{64}$' AND "walletStateSha256" ~ '^[0-9a-f]{64}$'
   AND isfinite("quarantinedAt") AND isfinite("restoredAt") AND "restoredAt" >= "quarantinedAt"
   AND "finalizedObservationId" <> "verifiedObservationId") IS TRUE
);
