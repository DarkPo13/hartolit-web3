-- AlterTable
ALTER TABLE "Field" ADD COLUMN     "publicReference" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "Passport" ADD COLUMN     "publicFarmLabel" VARCHAR(200);

-- AlterTable
ALTER TABLE "Treatment" ADD COLUMN     "timeZone" VARCHAR(64),
ADD COLUMN     "treatedAreaHectares" DECIMAL(12,4);

-- CreateIndex
CREATE UNIQUE INDEX "Field_publicReference_key" ON "Field"("publicReference");
