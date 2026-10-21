-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_WALLET_CHALLENGED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_WALLET_VERIFIED';

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "walletVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PublicationWalletChallenge" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "walletAddress" VARCHAR(42) NOT NULL,
    "origin" VARCHAR(255) NOT NULL,
    "nonce" CHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "signature" VARCHAR(132),

    CONSTRAINT "PublicationWalletChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationWalletChallenge_nonce_key" ON "PublicationWalletChallenge"("nonce");

-- CreateIndex
CREATE INDEX "PublicationWalletChallenge_publicationId_createdAt_idx" ON "PublicationWalletChallenge"("publicationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PublicationWalletChallenge" ADD CONSTRAINT "PublicationWalletChallenge_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationWalletChallenge" ADD CONSTRAINT "PublicationWalletChallenge_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep proof history consistent even if a later writer bypasses the service.
ALTER TABLE "PublicationWalletChallenge" ADD CONSTRAINT "PublicationWalletChallenge_signature_consumption_check"
CHECK (("consumedAt" IS NULL AND "signature" IS NULL) OR ("consumedAt" IS NOT NULL AND "signature" IS NOT NULL));
