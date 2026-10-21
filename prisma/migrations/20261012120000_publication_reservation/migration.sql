-- The previous Publication model had no writer. Never guess or erase a legacy row.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Publication") THEN
    RAISE EXCEPTION 'Publication reservation migration requires review of existing legacy publication rows';
  END IF;
END $$;

-- AlterEnum
ALTER TYPE "PublicationStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_RESERVED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_CANCELLED';

-- DropIndex
DROP INDEX "Publication_passportId_key";

-- AlterTable
ALTER TABLE "Publication" DROP COLUMN "publicSnapshot",
ADD COLUMN     "approvedVersion" INTEGER NOT NULL,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "canonicalJson" TEXT NOT NULL,
ADD COLUMN     "confirmationId" UUID NOT NULL,
ADD COLUMN     "passportVersion" INTEGER NOT NULL,
ADD COLUMN     "publisherWallet" VARCHAR(42) NOT NULL,
ADD COLUMN     "reservedById" TEXT NOT NULL,
ALTER COLUMN "payloadHash" SET NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "publicationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Publication_confirmationId_key" ON "Publication"("confirmationId");

-- CreateIndex
CREATE INDEX "Publication_passportId_status_idx" ON "Publication"("passportId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_confirmationId_passportId_key" ON "Publication"("confirmationId", "passportId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSnapshotConfirmation_id_passportId_key" ON "PublicSnapshotConfirmation"("id", "passportId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_confirmationId_passportId_fkey" FOREIGN KEY ("confirmationId", "passportId") REFERENCES "PublicSnapshotConfirmation"("id", "passportId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_reservedById_fkey" FOREIGN KEY ("reservedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
