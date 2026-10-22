-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_PREPARED';

-- CreateTable
CREATE TABLE "PublicationMintPreparation" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "pinAttemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "intentJson" TEXT NOT NULL,
    "intentSha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintPreparation_publicationId_key" ON "PublicationMintPreparation"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintPreparation_pinAttemptId_key" ON "PublicationMintPreparation"("pinAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintPreparation_requestId_key" ON "PublicationMintPreparation"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintPreparation_pinAttemptId_publicationId_key" ON "PublicationMintPreparation"("pinAttemptId", "publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationPinAttempt_id_publicationId_key" ON "PublicationPinAttempt"("id", "publicationId");

-- AddForeignKey
ALTER TABLE "PublicationMintPreparation" ADD CONSTRAINT "PublicationMintPreparation_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintPreparation" ADD CONSTRAINT "PublicationMintPreparation_pinAttemptId_publicationId_fkey" FOREIGN KEY ("pinAttemptId", "publicationId") REFERENCES "PublicationPinAttempt"("id", "publicationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Detailed canonical/schema/hash validation is performed by the locked service.
-- SQL also rejects absent/mismatched commitment metadata and oversized records.
ALTER TABLE "PublicationMintPreparation" ADD CONSTRAINT "PublicationMintPreparation_commitment_check" CHECK (
  ("intentSha256" ~ '^[0-9a-f]{64}$'
    AND octet_length("intentJson") <= 8192
    AND jsonb_typeof("intentJson"::jsonb) = 'object'
    AND "intentJson"::jsonb ->> 'sha256' = "intentSha256"
    AND "intentJson"::jsonb ->> 'version' = '1') IS TRUE
);
