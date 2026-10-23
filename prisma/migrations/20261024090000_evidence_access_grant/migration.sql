SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "EvidenceAccessBasis" AS ENUM ('DATA_SUBJECT_CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST');

-- CreateEnum
CREATE TYPE "EvidenceAccessScope" AS ENUM ('EVIDENCE', 'MAPPING', 'EVIDENCE_AND_MAPPING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_ACCESS_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_ACCESS_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_DOWNLOADED';

-- CreateTable
CREATE TABLE "EvidenceAccessGrant" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "organization" VARCHAR(200) NOT NULL,
    "basis" "EvidenceAccessBasis" NOT NULL,
    "basisReference" VARCHAR(200) NOT NULL,
    "purpose" VARCHAR(500) NOT NULL,
    "scope" "EvidenceAccessScope" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "EvidenceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceAccessGrant_passportId_expiresAt_idx" ON "EvidenceAccessGrant"("passportId", "expiresAt");

-- CreateIndex
CREATE INDEX "EvidenceAccessGrant_grantedById_idx" ON "EvidenceAccessGrant"("grantedById");

-- AddForeignKey
ALTER TABLE "EvidenceAccessGrant" ADD CONSTRAINT "EvidenceAccessGrant_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAccessGrant" ADD CONSTRAINT "EvidenceAccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAccessGrant" ADD CONSTRAINT "EvidenceAccessGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most 30 days; revocation fields move together; texts are not blank.
ALTER TABLE "EvidenceAccessGrant" ADD CONSTRAINT "EvidenceAccessGrant_shape_check" CHECK (
  (char_length(btrim("organization")) BETWEEN 2 AND 200 AND char_length(btrim("basisReference")) BETWEEN 2 AND 200
   AND char_length(btrim("purpose")) BETWEEN 3 AND 500 AND isfinite("grantedAt") AND isfinite("expiresAt")
   AND "expiresAt" > "grantedAt" AND "expiresAt" <= "grantedAt" + interval '30 days'
   AND ("revokedAt" IS NULL) = ("revokedById" IS NULL) AND ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt")) IS TRUE
);
RESET lock_timeout;
RESET statement_timeout;
