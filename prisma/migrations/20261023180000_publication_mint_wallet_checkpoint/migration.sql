SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- CreateTable
CREATE TABLE "PublicationMintWalletCheckpoint" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "publisherWallet" VARCHAR(42) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "baseCheckpointId" UUID,
    "coveredThroughNonce" BIGINT NOT NULL,
    "coveredCount" INTEGER NOT NULL,
    "coveredReanchorCount" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" VARCHAR(66) NOT NULL,
    "confirmations" INTEGER NOT NULL,
    "headBlockNumber" BIGINT NOT NULL,
    "headBlockHash" VARCHAR(66) NOT NULL,
    "coveredSha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationMintWalletCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintWalletCheckpoint_chainId_publisherWallet_seq_key" ON "PublicationMintWalletCheckpoint"("chainId", "publisherWallet", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMintWalletCheckpoint_id_chainId_publisherWallet_key" ON "PublicationMintWalletCheckpoint"("id", "chainId", "publisherWallet");

-- AddForeignKey
ALTER TABLE "PublicationMintWalletCheckpoint" ADD CONSTRAINT "PublicationMintWalletCheckpoint_base_fkey" FOREIGN KEY ("baseCheckpointId", "chainId", "publisherWallet") REFERENCES "PublicationMintWalletCheckpoint"("id", "chainId", "publisherWallet") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A checkpoint attests a canonical block at or above every covered anchor.
-- Its validity is rechecked from chain and DB state; rows are append-only.
ALTER TABLE "PublicationMintWalletCheckpoint" ADD CONSTRAINT "PublicationMintWalletCheckpoint_shape_check" CHECK (
  ("chainId" = 97 AND "publisherWallet" ~ '^0x[0-9a-f]{40}$' AND "publisherWallet" <> '0x0000000000000000000000000000000000000000'
   AND "sequence" >= 1 AND "coveredThroughNonce" BETWEEN 0 AND 9007199254740991 AND "coveredCount" >= 1
   AND "coveredReanchorCount" >= 0 AND "blockNumber" BETWEEN 0 AND 9007199254740991 AND "confirmations" >= 2
   AND "headBlockNumber" BETWEEN "blockNumber" AND 9007199254740991 AND "headBlockNumber" - "blockNumber" + 1 >= "confirmations"
   AND "blockHash" ~ '^0x[0-9a-f]{64}$' AND "headBlockHash" ~ '^0x[0-9a-f]{64}$' AND "coveredSha256" ~ '^[0-9a-f]{64}$'
   AND isfinite("createdAt") AND ("baseCheckpointId" IS NULL OR "baseCheckpointId" <> "id")) IS TRUE
);
RESET lock_timeout;
RESET statement_timeout;
