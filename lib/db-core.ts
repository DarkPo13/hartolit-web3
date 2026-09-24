import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalDb = globalThis as typeof globalThis & { hartolitDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalDb.hartolitDb) return globalDb.hartolitDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for authenticated access");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalDb.hartolitDb = db;
  return db;
}
