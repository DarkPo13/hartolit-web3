SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PRESERVATION_HOLD_PLACED';
ALTER TYPE "AuditAction" ADD VALUE 'PRESERVATION_HOLD_RELEASED';

-- CreateTable
CREATE TABLE "PreservationHold" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseNote" VARCHAR(500),

    CONSTRAINT "PreservationHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreservationHold_passportId_releasedAt_idx" ON "PreservationHold"("passportId", "releasedAt");

-- CreateIndex
CREATE INDEX "PreservationHold_placedById_idx" ON "PreservationHold"("placedById");

-- AddForeignKey
ALTER TABLE "PreservationHold" ADD CONSTRAINT "PreservationHold_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationHold" ADD CONSTRAINT "PreservationHold_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationHold" ADD CONSTRAINT "PreservationHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PreservationHold" ADD CONSTRAINT "PreservationHold_shape_check" CHECK (
  (char_length(btrim("reference")) BETWEEN 2 AND 200 AND char_length(btrim("reason")) BETWEEN 3 AND 500 AND isfinite("placedAt")
   AND ("releasedAt" IS NULL) = ("releasedById" IS NULL) AND ("releasedAt" IS NULL) = ("releaseNote" IS NULL)
   AND ("releasedAt" IS NULL OR ("releasedAt" >= "placedAt" AND char_length(btrim("releaseNote")) BETWEEN 3 AND 500))) IS TRUE
);

-- Database-level guard independent of application code: while a passport has an
-- active hold, its row and its evidence rows cannot be deleted and evidence
-- objects cannot be marked purged. Hold rows themselves are never deleted while active.
CREATE OR REPLACE FUNCTION "preservation_hold_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  -- Table-specific fields are read only inside their own branch: PL/pgSQL
  -- resolves record fields even in a short-circuited condition.
  IF TG_TABLE_NAME = 'PreservationHold' THEN
    IF OLD."releasedAt" IS NULL THEN
      RAISE EXCEPTION 'an active preservation hold cannot be deleted' USING ERRCODE = 'check_violation', CONSTRAINT = 'PreservationHold_active_guard';
    END IF;
    RETURN OLD;
  ELSIF TG_TABLE_NAME = 'Passport' THEN
    target := OLD."id";
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF NOT (OLD."objectPurgedAt" IS NULL AND NEW."objectPurgedAt" IS NOT NULL) THEN RETURN NEW; END IF;
    END IF;
    target := OLD."passportId";
  END IF;
  IF EXISTS (SELECT 1 FROM "PreservationHold" WHERE "passportId" = target AND "releasedAt" IS NULL) THEN
    RAISE EXCEPTION 'record is under a preservation hold' USING ERRCODE = 'check_violation', CONSTRAINT = 'PreservationHold_active_guard';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Passport_preservation_hold_guard" BEFORE DELETE ON "Passport" FOR EACH ROW EXECUTE FUNCTION "preservation_hold_guard"();
CREATE TRIGGER "EvidenceFile_preservation_hold_guard" BEFORE DELETE OR UPDATE OF "objectPurgedAt" ON "EvidenceFile" FOR EACH ROW EXECUTE FUNCTION "preservation_hold_guard"();
CREATE TRIGGER "PreservationHold_active_guard" BEFORE DELETE ON "PreservationHold" FOR EACH ROW EXECUTE FUNCTION "preservation_hold_guard"();
RESET lock_timeout;
RESET statement_timeout;
