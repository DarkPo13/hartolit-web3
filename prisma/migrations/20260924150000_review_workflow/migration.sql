ALTER TYPE "AuditAction" ADD VALUE 'PASSPORT_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'REVIEW_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'REVIEW_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'REVIEW_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSPORT_REOPENED';

ALTER TABLE "Passport"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "submittedVersion" INTEGER,
  ADD COLUMN "reviewerId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "approvedVersion" INTEGER,
  ADD COLUMN "reviewNote" VARCHAR(1000);
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Passport_status_reviewerId_submittedAt_idx" ON "Passport"("status", "reviewerId", "submittedAt" DESC);

ALTER TABLE "AuditLog"
  ADD COLUMN "fromStatus" "PassportStatus",
  ADD COLUMN "toStatus" "PassportStatus",
  ADD COLUMN "note" VARCHAR(1000),
  ADD COLUMN "targetUserId" TEXT;
