import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const url = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("The fictional seed is limited to a local PostgreSQL database.");
}
const ownerFlag = process.argv.indexOf("--owner");
const email = ownerFlag >= 0 ? process.argv[ownerFlag + 1] : undefined;
if (!email) throw new Error("Usage: npm run db:seed:fictional -- --owner operator@example.com");

const jiti = createJiti(import.meta.url);
const { getDb } = await jiti.import("../lib/db-core.ts");
const db = getDb();
try {
  const owner = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!owner) throw new Error("Owner account does not exist. Create an operator account first.");
  const marker = "PHASE2-FICTIONAL";
  const existing = await db.passport.findFirst({
    where: { ownerId: owner.id, farmer: { registrationId: marker } },
    select: { id: true },
  });
  if (existing) {
    process.stdout.write(`Fictional draft already exists: ${existing.id}\n`);
  } else {
    const passport = await db.$transaction(async (tx) => {
      const farmer = await tx.farmer.create({
        data: { ownerId: owner.id, legalName: "Fictional Pilot Farm", registrationId: marker },
      });
      const field = await tx.field.create({
        data: { ownerId: owner.id, farmerId: farmer.id, areaHectares: 12.5, crop: "sunflower", gpsCoords: "49.0000, 34.0000" },
      });
      const created = await tx.passport.create({
        data: {
          ownerId: owner.id, farmerId: farmer.id, fieldId: field.id,
          treatment: { create: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", droneModel: "Fictional Drone 1" } },
          meteo: { create: { temperatureCelsius: 22, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0 } },
          chemical: { create: { product: "Fictional Product", dosePerHa: 1.25 } },
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { passportId: created.id, actorId: owner.id, action: "DRAFT_CREATED", version: 1 } });
      return created;
    });
    process.stdout.write(`Created fictional draft: ${passport.id}\n`);
  }
} finally {
  await db.$disconnect();
}
