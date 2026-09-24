ALTER TYPE "EvidenceStatus" ADD VALUE 'SCANNING';
ALTER TYPE "EvidenceStatus" ADD VALUE 'QUARANTINED';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_RESERVED';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_READY';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_REJECTED';

ALTER TABLE "EvidenceFile" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "EvidenceFile" ADD COLUMN "scanLeaseUntil" TIMESTAMP(3);
ALTER TABLE "EvidenceFile" ADD COLUMN "rejectionCode" VARCHAR(40);
ALTER TABLE "EvidenceFile" ALTER COLUMN "uploadExpiresAt" DROP DEFAULT;

CREATE UNIQUE INDEX "Passport_id_ownerId_key" ON "Passport"("id", "ownerId");
ALTER TABLE "EvidenceFile" DROP CONSTRAINT "EvidenceFile_passportId_fkey";
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_passportId_ownerId_fkey" FOREIGN KEY ("passportId", "ownerId") REFERENCES "Passport"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "EvidenceFile_status_uploadExpiresAt_idx" ON "EvidenceFile"("status", "uploadExpiresAt");
