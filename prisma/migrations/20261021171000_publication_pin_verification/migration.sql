-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_PIN_VERIFIED';

-- AlterEnum
ALTER TYPE "PublicationPinAttemptStatus" ADD VALUE 'VERIFIED';

-- AlterEnum
ALTER TYPE "PublicationStatus" ADD VALUE 'PINNED';

-- AlterTable
ALTER TABLE "PublicationPinAttempt" ADD COLUMN     "expectedCid" VARCHAR(255),
ADD COLUMN     "providerPinId" VARCHAR(128),
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedCid" VARCHAR(255);

-- Replace the previous shape check, preserving existing uncertain attempts unchanged.
ALTER TABLE "PublicationPinAttempt" DROP CONSTRAINT "PublicationPinAttempt_timestamps_check";
ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_timestamps_check" CHECK (
  ("status"::text = 'PREPARED' AND "dispatchedAt" IS NULL AND "deadlineAt" IS NULL AND "closedAt" IS NULL)
  OR ("status"::text = 'CANCELLED' AND "dispatchedAt" IS NULL AND "deadlineAt" IS NULL AND "closedAt" IS NOT NULL)
  OR ("status"::text = 'DISPATCHING' AND "dispatchedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL AND "deadlineAt" > "dispatchedAt" AND "closedAt" IS NULL)
  OR ("status"::text IN ('UNKNOWN', 'VERIFIED') AND "dispatchedAt" IS NOT NULL AND "deadlineAt" IS NOT NULL AND "deadlineAt" > "dispatchedAt" AND "closedAt" IS NOT NULL)
);
ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_receipt_check" CHECK (
  ("status"::text = 'VERIFIED' AND "expectedCid" IS NOT NULL AND "verifiedCid" IS NOT NULL
    AND "verifiedCid" = "expectedCid" AND "providerPinId" IS NOT NULL AND length("providerPinId") > 0 AND "verifiedAt" IS NOT NULL)
  OR ("status"::text <> 'VERIFIED' AND "verifiedCid" IS NULL AND "providerPinId" IS NULL AND "verifiedAt" IS NULL)
);
