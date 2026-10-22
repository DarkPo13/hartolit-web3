-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "monitorNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "monitorToken" UUID,
ADD COLUMN     "monitorUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PublicationMintAttempt_monitorNextAt_id_idx" ON "PublicationMintAttempt"("monitorNextAt", "id");

ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_monitor_shape_check"
CHECK (
  isfinite("monitorNextAt") AND
  (("monitorToken" IS NULL AND "monitorUntil" IS NULL) OR
   ("monitorToken" IS NOT NULL AND "monitorUntil" IS NOT NULL AND isfinite("monitorUntil")))
);
