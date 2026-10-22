-- CreateEnum
CREATE TYPE "PublicationMintObservationStatus" AS ENUM ('UNKNOWN', 'UNAVAILABLE', 'MISMATCH', 'PENDING', 'CONFIRMING', 'VERIFIED', 'REVERTED', 'REORG');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_OBSERVED';

-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "observationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PublicationMintTransaction" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "nonce" BIGINT NOT NULL,
    "transactionHash" VARCHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationMintObservation" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "reportedHash" VARCHAR(66),
    "transactionId" UUID,
    "status" "PublicationMintObservationStatus" NOT NULL,
    "resultJson" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintTransaction_transactionHash_key" ON "PublicationMintTransaction"("transactionHash");

-- CreateIndex
CREATE INDEX "PublicationMintTransaction_attemptId_idx" ON "PublicationMintTransaction"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintTransaction_id_attemptId_key" ON "PublicationMintTransaction"("id", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintObservation_attemptId_revision_key" ON "PublicationMintObservation"("attemptId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintAttempt_id_nonce_key" ON "PublicationMintAttempt"("id", "nonce");

-- AddForeignKey
ALTER TABLE "PublicationMintTransaction" ADD CONSTRAINT "PublicationMintTransaction_attemptId_nonce_fkey" FOREIGN KEY ("attemptId", "nonce") REFERENCES "PublicationMintAttempt"("id", "nonce") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintObservation" ADD CONSTRAINT "PublicationMintObservation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintObservation" ADD CONSTRAINT "PublicationMintObservation_transactionId_attemptId_fkey" FOREIGN KEY ("transactionId", "attemptId") REFERENCES "PublicationMintTransaction"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_observation_version_check" CHECK ("observationVersion" >= 0);
ALTER TABLE "PublicationMintTransaction" ADD CONSTRAINT "PublicationMintTransaction_hash_check" CHECK ("transactionHash" ~ '^0x[0-9a-f]{64}$');
ALTER TABLE "PublicationMintObservation" ADD CONSTRAINT "PublicationMintObservation_result_check" CHECK (
  ("revision" > 0 AND octet_length("resultJson") <= 8192
    AND ("reportedHash" IS NULL OR "reportedHash" ~ '^0x[0-9a-f]{64}$')
    AND ("transactionId" IS NULL OR "reportedHash" IS NOT NULL)
    AND jsonb_typeof("resultJson"::jsonb) = 'object'
    AND "resultJson"::jsonb ->> 'version' = '1'
    AND "resultJson"::jsonb ->> 'status' = "status"::text
    AND "resultJson"::jsonb -> 'issued' = 'false'::jsonb
    AND "resultJson"::jsonb -> 'canResend' = 'false'::jsonb
    AND ("status" NOT IN ('PENDING','CONFIRMING','VERIFIED','REVERTED','REORG') OR "transactionId" IS NOT NULL)
    AND ("status" <> 'MISMATCH' OR "transactionId" IS NULL)
    AND ("status" <> 'VERIFIED' OR (
      "resultJson"::jsonb ->> 'transactionHash' = "reportedHash"
      AND "resultJson"::jsonb ->> 'tokenId' ~ '^[1-9][0-9]{0,77}$'
      AND "resultJson"::jsonb ->> 'blockNumber' ~ '^(0|[1-9][0-9]{0,77})$'
      AND "resultJson"::jsonb ->> 'blockHash' ~ '^0x[0-9a-f]{64}$'
      AND "resultJson"::jsonb ->> 'intentSha256' ~ '^[0-9a-f]{64}$'
    ))) IS TRUE
);
