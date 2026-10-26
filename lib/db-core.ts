import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalDb = globalThis as typeof globalThis & { hartolitDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalDb.hartolitDb) return globalDb.hartolitDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for authenticated access");

  // Connections per server process; the database must allow this times the process count.
  const max = Number(process.env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("DATABASE_POOL_MAX must be an integer from 1 to 100");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
  globalDb.hartolitDb = db;
  return db;
}
