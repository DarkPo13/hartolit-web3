SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- AlterEnum
ALTER TYPE "PublicationMintObservationStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_CANCELLED';

-- CreateTable
CREATE TABLE "PublicationMintCancellation" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "discoveryId" UUID NOT NULL,
    "discoveryStatus" "PublicationMintDiscoveryStatus" NOT NULL DEFAULT 'CONFLICT',
    "transactionHash" VARCHAR(66) NOT NULL,
    "observationId" UUID NOT NULL,
    "proofStatus" "PublicationMintObservationStatus" NOT NULL DEFAULT 'CANCELLED',
    "reviewedObservationVersion" INTEGER NOT NULL,
    "reviewedDiscoveryVersion" INTEGER NOT NULL,
    "intentSha256" CHAR(64) NOT NULL,
    "walletStateSha256" CHAR(64) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintCancellation_attemptId_key" ON "PublicationMintCancellation"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintCancellation_requestId_key" ON "PublicationMintCancellation"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintCancellation_observationId_key" ON "PublicationMintCancellation"("observationId");

-- CreateIndex
CREATE INDEX "PublicationMintCancellation_discoveryId_idx" ON "PublicationMintCancellation"("discoveryId");

-- CreateIndex
CREATE INDEX "PublicationMintCancellation_actorId_idx" ON "PublicationMintCancellation"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintCancellation_observationId_attemptId_transac_key" ON "PublicationMintCancellation"("observationId", "attemptId", "transactionHash", "proofStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintObservation_cancellation_binding_key" ON "PublicationMintObservation"("id", "attemptId", "reportedHash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintDiscovery_cancellation_binding_key" ON "PublicationMintDiscovery"("id", "attemptId", "transactionHash", "status");

-- AddForeignKey
ALTER TABLE "PublicationMintCancellation" ADD CONSTRAINT "PublicationMintCancellation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintCancellation" ADD CONSTRAINT "PublicationMintCancellation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintCancellation" ADD CONSTRAINT "PublicationMintCancellation_discovery_fkey" FOREIGN KEY ("discoveryId", "attemptId", "transactionHash", "discoveryStatus") REFERENCES "PublicationMintDiscovery"("id", "attemptId", "transactionHash", "status") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintCancellation" ADD CONSTRAINT "PublicationMintCancellation_proof_fkey" FOREIGN KEY ("observationId", "attemptId", "transactionHash", "proofStatus") REFERENCES "PublicationMintObservation"("id", "attemptId", "reportedHash", "status") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationMintAttempt" DROP CONSTRAINT "PublicationMintAttempt_shape_check";
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_shape_check" CHECK (
  ("chainId" = 97 AND "publisherWallet" ~ '^0x[0-9a-f]{40}$' AND "publisherWallet" <> '0x0000000000000000000000000000000000000000'
  AND "nonce" BETWEEN 0 AND 9007199254740991 AND "deadlineAt" > "createdAt"
  AND ("unknownAt" IS NULL OR "unknownAt" >= "createdAt")
  AND (("status" = 'DISPATCHING' AND "unknownAt" IS NULL) OR ("status" = 'UNKNOWN' AND "unknownAt" IS NOT NULL)
    OR "status" IN ('FINALIZED', 'FAILED_TERMINAL'))
  AND (("status" = 'FINALIZED' AND "finalizedAt" IS NOT NULL AND "finalizedAt" >= "createdAt"
    AND "finalizedObservationId" IS NOT NULL AND "finalizationStatus" = 'VERIFIED')
    OR ("status" <> 'FINALIZED' AND "finalizedAt" IS NULL AND "finalizedObservationId" IS NULL AND "finalizationStatus" IS NULL))
  AND (("status" = 'FAILED_TERMINAL' AND "failedAt" IS NOT NULL AND "failedAt" >= "createdAt"
    AND "failedObservationId" IS NOT NULL AND "failureStatus" IN ('REVERTED', 'CANCELLED'))
    OR ("status" <> 'FAILED_TERMINAL' AND "failedAt" IS NULL AND "failedObservationId" IS NULL AND "failureStatus" IS NULL))
  AND ("quarantinedAt" IS NULL OR ("status" IN ('FINALIZED', 'FAILED_TERMINAL')
    AND "quarantinedAt" >= COALESCE("finalizedAt", "failedAt")))) IS TRUE
) NOT VALID;


ALTER TABLE "PublicationMintAttempt" VALIDATE CONSTRAINT "PublicationMintAttempt_shape_check";
ALTER TABLE "PublicationMintCancellation" ADD CONSTRAINT "PublicationMintCancellation_shape_check" CHECK (
  ("proofStatus" = 'CANCELLED' AND "discoveryStatus" = 'CONFLICT' AND "reviewedObservationVersion" >= 0
   AND "reviewedDiscoveryVersion" > 0 AND isfinite("closedAt")
   AND "transactionHash" ~ '^0x[0-9a-f]{64}$' AND "intentSha256" ~ '^[0-9a-f]{64}$'
   AND "walletStateSha256" ~ '^[0-9a-f]{64}$') IS TRUE
);
ALTER TABLE "PublicationMintObservation" DROP CONSTRAINT "PublicationMintObservation_result_check";
ALTER TABLE "PublicationMintObservation" ADD CONSTRAINT "PublicationMintObservation_result_check" CHECK (
  ("revision" > 0 AND octet_length("resultJson") <= 8192
    AND ("reportedHash" IS NULL OR "reportedHash" ~ '^0x[0-9a-f]{64}$')
    AND ("transactionId" IS NULL OR "reportedHash" IS NOT NULL)
    AND jsonb_typeof("resultJson"::jsonb) = 'object'
    AND "resultJson"::jsonb ->> 'version' = '1'
    AND "resultJson"::jsonb ->> 'status' = "status"::text
    AND "resultJson"::jsonb -> 'issued' = 'false'::jsonb
    AND "resultJson"::jsonb -> 'canResend' = 'false'::jsonb
    AND ("status" NOT IN ('PENDING','CONFIRMING','VERIFIED','REVERTED','REORG') OR "transactionId" IS NOT NULL OR ("resultJson"::jsonb ->> 'proofKind' = 'CANCELLATION' AND "status" IN ('PENDING','CONFIRMING','REORG')))
    AND ("status" <> 'MISMATCH' OR "transactionId" IS NULL)
    AND ("status" <> 'VERIFIED' OR (
      "resultJson"::jsonb ->> 'transactionHash' = "reportedHash"
      AND "resultJson"::jsonb ->> 'tokenId' ~ '^[1-9][0-9]{0,77}$'
      AND "resultJson"::jsonb ->> 'blockNumber' ~ '^(0|[1-9][0-9]{0,77})$'
      AND "resultJson"::jsonb ->> 'blockHash' ~ '^0x[0-9a-f]{64}$'
      AND "resultJson"::jsonb ->> 'intentSha256' ~ '^[0-9a-f]{64}$'
    ))) IS TRUE
) NOT VALID;
ALTER TABLE "PublicationMintObservation" VALIDATE CONSTRAINT "PublicationMintObservation_result_check";

ALTER TABLE "PublicationMintObservation" ADD CONSTRAINT "PublicationMintObservation_cancellation_check" CHECK (
  (("status" <> 'CANCELLED' OR ("resultJson"::jsonb ->> 'proofKind' = 'CANCELLATION'
      AND "resultJson"::jsonb ->> 'transactionHash' = "reportedHash"
      AND "resultJson"::jsonb ->> 'nonce' ~ '^(0|[1-9][0-9]{0,77})$'
      AND "resultJson"::jsonb ->> 'blockHash' ~ '^0x[0-9a-f]{64}$'))
   AND ("resultJson"::jsonb ->> 'proofKind' IS DISTINCT FROM 'CANCELLATION' OR
      ("reportedHash" IS NOT NULL AND "transactionId" IS NULL AND "status" NOT IN ('VERIFIED','REVERTED')))) IS TRUE
) NOT VALID;
ALTER TABLE "PublicationMintObservation" VALIDATE CONSTRAINT "PublicationMintObservation_cancellation_check";
RESET lock_timeout;
RESET statement_timeout;
