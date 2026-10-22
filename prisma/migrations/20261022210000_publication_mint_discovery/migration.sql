-- CreateEnum
CREATE TYPE "PublicationMintDiscoveryStatus" AS ENUM ('FOUND', 'CONFLICT', 'SCANNED', 'CAUGHT_UP', 'REORG', 'UNAVAILABLE');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_MINT_SEARCHED';

-- AlterTable
ALTER TABLE "PublicationMintAttempt" ADD COLUMN     "discoveryBlockHash" VARCHAR(66),
ADD COLUMN     "discoveryBlockNumber" BIGINT,
ADD COLUMN     "discoveryVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchBlockHash" VARCHAR(66),
ADD COLUMN     "dispatchBlockNumber" BIGINT;

-- CreateTable
CREATE TABLE "PublicationMintDiscovery" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "PublicationMintDiscoveryStatus" NOT NULL,
    "fromBlock" BIGINT,
    "throughBlock" BIGINT,
    "throughBlockHash" VARCHAR(66),
    "headBlock" BIGINT,
    "headBlockHash" VARCHAR(66),
    "scannedBlocks" INTEGER NOT NULL DEFAULT 0,
    "scannedTransactions" INTEGER NOT NULL DEFAULT 0,
    "resetToDispatchAnchor" BOOLEAN NOT NULL DEFAULT false,
    "transactionHash" VARCHAR(66),
    "transactionId" UUID,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintDiscovery_attemptId_revision_key" ON "PublicationMintDiscovery"("attemptId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintTransaction_id_attemptId_transactionHash_key" ON "PublicationMintTransaction"("id", "attemptId", "transactionHash");

-- AddForeignKey
ALTER TABLE "PublicationMintDiscovery" ADD CONSTRAINT "PublicationMintDiscovery_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PublicationMintAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMintDiscovery" ADD CONSTRAINT "PublicationMintDiscovery_transactionId_attemptId_transacti_fkey" FOREIGN KEY ("transactionId", "attemptId", "transactionHash") REFERENCES "PublicationMintTransaction"("id", "attemptId", "transactionHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Null dispatch anchors identify historical permissions; never invent a baseline.
ALTER TABLE "PublicationMintAttempt" ADD CONSTRAINT "PublicationMintAttempt_discovery_check" CHECK (
  ("discoveryVersion" >= 0
  AND (("dispatchBlockNumber" IS NULL AND "dispatchBlockHash" IS NULL AND "discoveryVersion" = 0)
    OR ("dispatchBlockNumber" BETWEEN 0 AND 9007199254740991 AND "dispatchBlockHash" ~ '^0x[0-9a-f]{64}$'))
  AND (("discoveryBlockNumber" IS NULL AND "discoveryBlockHash" IS NULL)
    OR ("dispatchBlockNumber" IS NOT NULL AND "discoveryBlockNumber" BETWEEN "dispatchBlockNumber" AND 9007199254740991
      AND "discoveryBlockHash" ~ '^0x[0-9a-f]{64}$'))) IS TRUE
);

ALTER TABLE "PublicationMintDiscovery" ADD CONSTRAINT "PublicationMintDiscovery_page_check" CHECK (
  ("revision" > 0 AND "scannedBlocks" BETWEEN 0 AND 32 AND "scannedTransactions" BETWEEN 0 AND 4096
  AND (("headBlock" IS NULL AND "headBlockHash" IS NULL)
    OR ("headBlock" BETWEEN 0 AND 9007199254740991 AND "headBlockHash" ~ '^0x[0-9a-f]{64}$'))
  AND (("fromBlock" IS NULL AND "throughBlock" IS NULL AND "throughBlockHash" IS NULL AND "scannedBlocks" = 0)
    OR ("fromBlock" >= 0 AND "throughBlock" BETWEEN "fromBlock" AND "headBlock" AND "throughBlockHash" ~ '^0x[0-9a-f]{64}$'
      AND "scannedBlocks" = "throughBlock" - "fromBlock" + 1))
  AND (("status" = 'FOUND' AND "transactionId" IS NOT NULL AND "transactionHash" ~ '^0x[0-9a-f]{64}$' AND "fromBlock" IS NOT NULL)
    OR ("status" = 'CONFLICT' AND "transactionId" IS NULL AND "transactionHash" ~ '^0x[0-9a-f]{64}$' AND "fromBlock" IS NOT NULL)
    OR ("status" NOT IN ('FOUND','CONFLICT') AND "transactionId" IS NULL AND "transactionHash" IS NULL))
  AND (NOT "resetToDispatchAnchor" OR ("status" = 'REORG' AND "headBlock" IS NOT NULL))
  AND ("status" NOT IN ('SCANNED','CAUGHT_UP') OR ("headBlock" IS NOT NULL AND NOT "resetToDispatchAnchor"))
  AND ("status" <> 'SCANNED' OR ("scannedBlocks" = 32 AND "throughBlock" < "headBlock"))
  AND ("status" <> 'CAUGHT_UP' OR "throughBlock" IS NULL OR "throughBlock" = "headBlock")
  AND ("status" NOT IN ('REORG','UNAVAILABLE') OR ("fromBlock" IS NULL AND "scannedBlocks" = 0 AND "scannedTransactions" = 0))) IS TRUE
);
