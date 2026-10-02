CREATE TYPE "DoseUnit" AS ENUM ('L_PER_HA', 'KG_PER_HA');

ALTER TABLE "ChemicalApplication" ADD COLUMN "doseUnit" "DoseUnit";
