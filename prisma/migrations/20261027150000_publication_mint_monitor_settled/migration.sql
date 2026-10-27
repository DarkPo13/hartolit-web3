-- D76: a closed mint proof stops being monitored once it is settled. Only closed
-- attempts can be settled; reopening one (D75) must clear the mark in the same update.
ALTER TABLE "PublicationMintAttempt" ADD COLUMN "monitorSettledAt" TIMESTAMP(3);

ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_monitor_settled_check"
  CHECK ("monitorSettledAt" IS NULL OR (isfinite("monitorSettledAt") AND "status" IN ('FINALIZED', 'FAILED_TERMINAL')));
