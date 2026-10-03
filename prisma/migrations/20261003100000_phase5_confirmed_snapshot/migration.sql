ALTER TYPE "AuditAction" ADD VALUE 'PUBLIC_SNAPSHOT_CONFIRMED';

CREATE TABLE "PublicSnapshotConfirmation" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "approvedVersion" INTEGER NOT NULL,
    "passportVersion" INTEGER NOT NULL,
    "certificateId" UUID NOT NULL,
    "canonicalJson" TEXT NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "weatherFileId" UUID NOT NULL,
    "chemicalFileId" UUID NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "PublicSnapshotConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicSnapshotConfirmation_certificateId_key" ON "PublicSnapshotConfirmation"("certificateId");
CREATE UNIQUE INDEX "PublicSnapshotConfirmation_payloadHash_key" ON "PublicSnapshotConfirmation"("payloadHash");
CREATE UNIQUE INDEX "PublicSnapshotConfirmation_passportId_approvedVersion_key" ON "PublicSnapshotConfirmation"("passportId", "approvedVersion");
CREATE INDEX "PublicSnapshotConfirmation_passportId_invalidatedAt_idx" ON "PublicSnapshotConfirmation"("passportId", "invalidatedAt");

ALTER TABLE "PublicSnapshotConfirmation" ADD CONSTRAINT "PublicSnapshotConfirmation_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicSnapshotConfirmation" ADD CONSTRAINT "PublicSnapshotConfirmation_weatherFileId_fkey" FOREIGN KEY ("weatherFileId") REFERENCES "EvidenceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicSnapshotConfirmation" ADD CONSTRAINT "PublicSnapshotConfirmation_chemicalFileId_fkey" FOREIGN KEY ("chemicalFileId") REFERENCES "EvidenceFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicSnapshotConfirmation" ADD CONSTRAINT "PublicSnapshotConfirmation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
