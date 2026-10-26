-- Two-person reopening of closed mints and dispatch re-anchoring (D75, user decision 2026-10-26).
-- Closures become a history per attempt, because a reopened attempt can close again.
-- CreateEnum
CREATE TYPE "PublicationMintReopenKind" AS ENUM ('LOST', 'SUCCESS_REVERTED', 'FAILURE_SUCCEEDED', 'TOKEN_CHANGED', 'CANCELLATION_CHANGED', 'DISPATCH_ANCHOR_CHANGED');
-- CreateEnum
CREATE TYPE "PublicationMintReopenStatus" AS ENUM ('PROPOSED', 'APPLIED', 'WITHDRAWN');
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_REOPEN_PROPOSED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_REOPEN_WITHDRAWN';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_DISPATCH_REANCHORED';
-- DropIndex
DROP INDEX "PublicationMintCancellation_attemptId_key";
-- DropIndex
DROP INDEX "PublicationMintFailure_attemptId_key";
-- CreateTable
CREATE TABLE "PublicationMintReopen" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" "PublicationMintReopenKind" NOT NULL,
    "status" "PublicationMintReopenStatus" NOT NULL DEFAULT 'PROPOSED',
    "reason" VARCHAR(1000) NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedHeadBlock" BIGINT NOT NULL,
    "proposalEvidenceJson" TEXT NOT NULL,
    "reviewedObservationVersion" INTEGER NOT NULL,
    "priorStatus" "PublicationMintAttemptStatus" NOT NULL,
    "priorProofObservationId" UUID,
    "priorTokenId" VARCHAR(78),
    "priorAnchorBlockNumber" BIGINT,
    "priorAnchorBlockHash" VARCHAR(66),
    "newAnchorBlockNumber" BIGINT,
    "newAnchorBlockHash" VARCHAR(66),
    "approvedById" TEXT,
    "approvalRequestId" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedHeadBlock" BIGINT,
    "approvalEvidenceJson" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "PublicationMintReopen_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReopen_requestId_key" ON "PublicationMintReopen"("requestId");
-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintReopen_approvalRequestId_key" ON "PublicationMintReopen"("approvalRequestId");
-- CreateIndex
CREATE INDEX "PublicationMintReopen_attemptId_status_idx" ON "PublicationMintReopen"("attemptId", "status");
-- CreateIndex
CREATE INDEX "PublicationMintCancellation_attemptId_idx" ON "PublicationMintCancellation"("attemptId");
-- CreateIndex
CREATE INDEX "PublicationMintFailure_attemptId_idx" ON "PublicationMintFailure"("attemptId");
-- AddForeignKey
ALTER TABLE "PublicationMintReopen" ADD CONSTRAINT "PublicationMintReopen_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PublicationMintReopen" ADD CONSTRAINT "PublicationMintReopen_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PublicationMintReopen" ADD CONSTRAINT "PublicationMintReopen_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one open proposal per attempt; the approver is never the proposer.
CREATE UNIQUE INDEX "PublicationMintReopen_one_proposed_per_attempt" ON "PublicationMintReopen"("attemptId") WHERE "status" = 'PROPOSED';
ALTER TABLE "PublicationMintReopen" ADD CONSTRAINT "PublicationMintReopen_shape_check" CHECK (
  (char_length(btrim("reason")) BETWEEN 10 AND 1000 AND "reviewedObservationVersion" >= 0 AND "proposedHeadBlock" >= 0
   AND char_length("proposalEvidenceJson") <= 8192 AND ("approvalEvidenceJson" IS NULL OR char_length("approvalEvidenceJson") <= 8192)
   AND ("priorTokenId" IS NULL OR "priorTokenId" ~ '^[1-9][0-9]{0,77}$')
   AND (("kind" = 'DISPATCH_ANCHOR_CHANGED' AND "priorStatus" IN ('DISPATCHING', 'UNKNOWN') AND "priorProofObservationId" IS NULL
         AND "priorAnchorBlockNumber" IS NOT NULL AND "priorAnchorBlockHash" ~ '^0x[0-9a-f]{64}$'
         AND "newAnchorBlockNumber" IS NOT NULL AND "newAnchorBlockHash" ~ '^0x[0-9a-f]{64}$' AND "newAnchorBlockNumber" < "priorAnchorBlockNumber")
     OR ("kind" <> 'DISPATCH_ANCHOR_CHANGED' AND "priorStatus" IN ('FINALIZED', 'FAILED_TERMINAL') AND "priorProofObservationId" IS NOT NULL
         AND "priorAnchorBlockNumber" IS NULL AND "priorAnchorBlockHash" IS NULL AND "newAnchorBlockNumber" IS NULL AND "newAnchorBlockHash" IS NULL))
   AND (("status" = 'PROPOSED' AND "approvedById" IS NULL AND "approvalRequestId" IS NULL AND "approvedAt" IS NULL
         AND "approvedHeadBlock" IS NULL AND "approvalEvidenceJson" IS NULL AND "withdrawnAt" IS NULL)
     OR ("status" = 'APPLIED' AND "approvedById" IS NOT NULL AND "approvedById" <> "proposedById" AND "approvalRequestId" IS NOT NULL
         AND "approvedAt" >= "proposedAt" AND "approvedHeadBlock" >= "proposedHeadBlock" AND "approvalEvidenceJson" IS NOT NULL AND "withdrawnAt" IS NULL)
     OR ("status" = 'WITHDRAWN' AND "approvedById" IS NULL AND "withdrawnAt" >= "proposedAt"))) IS TRUE
);
