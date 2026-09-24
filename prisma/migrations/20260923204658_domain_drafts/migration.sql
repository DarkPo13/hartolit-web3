-- CreateEnum
CREATE TYPE "PassportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'CORRECTION_REQUIRED', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED_RETRYABLE');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('METEO', 'CHEMICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('RESERVED', 'PINNING', 'CHAIN_PENDING', 'PUBLISHED', 'FAILED_RETRYABLE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('DRAFT_CREATED', 'DRAFT_UPDATED');

-- CreateTable
CREATE TABLE "Farmer" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "legalName" VARCHAR(200),
    "registrationId" VARCHAR(32),
    "contactName" VARCHAR(200),
    "contactEmail" VARCHAR(320),
    "contactPhone" VARCHAR(40),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Field" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "farmerId" UUID NOT NULL,
    "label" VARCHAR(200),
    "areaHectares" DECIMAL(12,4),
    "gpsCoords" VARCHAR(80),
    "cadastralNumber" VARCHAR(40),
    "crop" VARCHAR(100),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passport" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "farmerId" UUID NOT NULL,
    "fieldId" UUID NOT NULL,
    "status" "PassportStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Passport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Treatment" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "treatmentType" VARCHAR(100),
    "treatmentDate" VARCHAR(10),
    "treatmentTime" VARCHAR(5),
    "droneModel" VARCHAR(200),
    "droneSerial" VARCHAR(200),
    "operator" VARCHAR(200),
    "pilotCert" VARCHAR(200),
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Treatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeteoMeasurement" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "temperatureCelsius" DECIMAL(6,2),
    "humidityPercent" DECIMAL(5,2),
    "windSpeedMps" DECIMAL(6,2),
    "rainfallMm" DECIMAL(7,2),
    "measuredAt" TIMESTAMP(3),
    "sourceFileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeteoMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChemicalApplication" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "product" VARCHAR(200),
    "activeSubstance" VARCHAR(200),
    "dosePerHa" DECIMAL(12,4),
    "workingVolume" DECIMAL(12,4),
    "manufacturer" VARCHAR(200),
    "registrationNo" VARCHAR(100),
    "supplierName" VARCHAR(200),
    "supplierEdrpou" VARCHAR(32),
    "sourceFileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChemicalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "passportId" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" VARCHAR(512) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(255) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "publicSnapshot" JSONB,
    "payloadHash" CHAR(64),
    "ipfsCid" VARCHAR(255),
    "chainId" INTEGER,
    "contractAddress" VARCHAR(42),
    "transactionHash" VARCHAR(66),
    "tokenId" VARCHAR(78),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "passportId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Farmer_ownerId_legalName_idx" ON "Farmer"("ownerId", "legalName");

-- CreateIndex
CREATE INDEX "Farmer_ownerId_registrationId_idx" ON "Farmer"("ownerId", "registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_id_ownerId_key" ON "Farmer"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Field_ownerId_cadastralNumber_idx" ON "Field"("ownerId", "cadastralNumber");

-- CreateIndex
CREATE INDEX "Field_farmerId_idx" ON "Field"("farmerId");

-- CreateIndex
CREATE UNIQUE INDEX "Field_id_ownerId_key" ON "Field"("id", "ownerId");

-- CreateIndex
CREATE INDEX "Passport_ownerId_updatedAt_id_idx" ON "Passport"("ownerId", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Passport_status_updatedAt_idx" ON "Passport"("status", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Treatment_passportId_key" ON "Treatment"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "MeteoMeasurement_passportId_key" ON "MeteoMeasurement"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "ChemicalApplication_passportId_key" ON "ChemicalApplication"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFile_objectKey_key" ON "EvidenceFile"("objectKey");

-- CreateIndex
CREATE INDEX "EvidenceFile_passportId_kind_idx" ON "EvidenceFile"("passportId", "kind");

-- CreateIndex
CREATE INDEX "EvidenceFile_ownerId_createdAt_idx" ON "EvidenceFile"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Publication_passportId_key" ON "Publication"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_idempotencyKey_key" ON "Publication"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_payloadHash_key" ON "Publication"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_chainId_contractAddress_tokenId_key" ON "Publication"("chainId", "contractAddress", "tokenId");

-- CreateIndex
CREATE INDEX "AuditLog_passportId_createdAt_idx" ON "AuditLog"("passportId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_farmerId_ownerId_fkey" FOREIGN KEY ("farmerId", "ownerId") REFERENCES "Farmer"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_farmerId_ownerId_fkey" FOREIGN KEY ("farmerId", "ownerId") REFERENCES "Farmer"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_fieldId_ownerId_fkey" FOREIGN KEY ("fieldId", "ownerId") REFERENCES "Field"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeteoMeasurement" ADD CONSTRAINT "MeteoMeasurement_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeteoMeasurement" ADD CONSTRAINT "MeteoMeasurement_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "EvidenceFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChemicalApplication" ADD CONSTRAINT "ChemicalApplication_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChemicalApplication" ADD CONSTRAINT "ChemicalApplication_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "EvidenceFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
