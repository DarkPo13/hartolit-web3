SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "DraftNoticeEmailStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "DraftRetentionNotice" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "noticedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "draftUpdatedAt" TIMESTAMP(3) NOT NULL,
    "emailStatus" "DraftNoticeEmailStatus" NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DraftRetentionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftRetentionNotice_passportId_noticedAt_idx" ON "DraftRetentionNotice"("passportId", "noticedAt");

-- CreateIndex
CREATE INDEX "DraftRetentionNotice_deletedAt_deleteAfter_idx" ON "DraftRetentionNotice"("deletedAt", "deleteAfter");

-- The notice period is exactly 30 days; only a sent notice can lead to deletion.
ALTER TABLE "DraftRetentionNotice" ADD CONSTRAINT "DraftRetentionNotice_shape_check" CHECK (
  (isfinite("noticedAt") AND "deleteAfter" = "noticedAt" + interval '30 days' AND "draftUpdatedAt" <= "noticedAt"
   AND ("deletedAt" IS NULL OR ("emailStatus" = 'SENT' AND "deletedAt" >= "deleteAfter"))) IS TRUE
);
RESET lock_timeout;
RESET statement_timeout;
