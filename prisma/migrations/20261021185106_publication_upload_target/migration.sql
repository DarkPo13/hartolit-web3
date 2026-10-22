-- AlterTable
ALTER TABLE "PublicationPinAttempt" ADD COLUMN     "providerConfigHash" CHAR(64),
ADD COLUMN     "providerKey" VARCHAR(80),
ADD COLUMN     "storageProfile" VARCHAR(64);
-- Preserve historical unbound rows; a new dispatcher must reject them explicitly.
ALTER TABLE "PublicationPinAttempt" ADD CONSTRAINT "PublicationPinAttempt_target_check" CHECK (
  ("providerKey" IS NULL AND "providerConfigHash" IS NULL AND "storageProfile" IS NULL)
  OR ("providerKey" IS NOT NULL AND length("providerKey") > 0 AND "providerConfigHash" IS NOT NULL
    AND "providerConfigHash" ~ '^[0-9a-f]{64}$' AND "storageProfile" IS NOT NULL
    AND "storageProfile" = 'raw-cidv1-sha256-64k-v1')
);
