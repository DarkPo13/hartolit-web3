SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PUBLICATION_CORRECTION_OPENED';

-- CreateTable
CREATE TABLE "PublicationCorrection" (
    "id" UUID NOT NULL,
    "supersededPublicationId" UUID NOT NULL,
    "supersededPassportId" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "correctionPassportId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationCorrection_supersededPublicationId_key" ON "PublicationCorrection"("supersededPublicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationCorrection_correctionPassportId_key" ON "PublicationCorrection"("correctionPassportId");

-- CreateIndex
CREATE INDEX "PublicationCorrection_supersededPassportId_idx" ON "PublicationCorrection"("supersededPassportId");

-- CreateIndex
CREATE INDEX "PublicationCorrection_actorId_idx" ON "PublicationCorrection"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_id_passportId_key" ON "Publication"("id", "passportId");

-- AddForeignKey
ALTER TABLE "PublicationCorrection" ADD CONSTRAINT "PublicationCorrection_superseded_publication_fkey" FOREIGN KEY ("supersededPublicationId", "supersededPassportId") REFERENCES "Publication"("id", "passportId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationCorrection" ADD CONSTRAINT "PublicationCorrection_superseded_passport_fkey" FOREIGN KEY ("supersededPassportId", "ownerId") REFERENCES "Passport"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationCorrection" ADD CONSTRAINT "PublicationCorrection_correction_passport_fkey" FOREIGN KEY ("correctionPassportId", "ownerId") REFERENCES "Passport"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationCorrection" ADD CONSTRAINT "PublicationCorrection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A correction never points a passport at itself; the reason is private staff text.
ALTER TABLE "PublicationCorrection" ADD CONSTRAINT "PublicationCorrection_shape_check" CHECK (
  ("supersededPassportId" <> "correctionPassportId" AND char_length(btrim("reason")) BETWEEN 3 AND 500
   AND isfinite("openedAt")) IS TRUE
);
RESET lock_timeout;
RESET statement_timeout;
