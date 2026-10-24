// Publication monitoring for a trusted scheduler (D69). Without flags: a summary
// without RPC. --run [--limit N]: one bounded batch of mint monitoring ticks (D42)
// with the server-configured chain reader (D68). Prints counts only, never ids,
// hashes or provider text. Exit 1 when something needs attention, 2 when the
// chain reader is not configured for --run.
import path from "node:path";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const run = process.argv.includes("--run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 5;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { getDb } = await jiti.import("../lib/db-core.ts");
const { runMintMonitorBatch } = await jiti.import("../lib/publication/mint-monitor.ts");
const { configuredMintReaderFor, mintConfigured } = await jiti.import("../lib/publication/mint-config.ts");
const db = getDb();
try {
  let batch = null, error = null;
  if (run) {
    if (!mintConfigured()) { error = "mint chain reader is not configured"; process.exitCode = 2; }
    else {
      const result = await runMintMonitorBatch({ limit }, configuredMintReaderFor);
      batch = { checked: result.checked, statuses: Object.fromEntries(Object.entries(Object.groupBy(result.results, row => row.status)).map(([key, rows]) => [key, rows.length])) };
    }
  }
  const attempts = Object.fromEntries((await db.publicationMintAttempt.groupBy({ by: ["status"], _count: { _all: true } })).map(row => [row.status, row._count._all]));
  const quarantined = await db.publicationMintAttempt.count({ where: { quarantinedAt: { not: null } } });
  const overdue = await db.publicationMintAttempt.count({ where: { status: { in: ["DISPATCHING", "UNKNOWN"] }, deadlineAt: { lt: new Date() } } });
  const pinUnknown = await db.publicationPinAttempt.count({ where: { status: { in: ["DISPATCHING", "UNKNOWN"] } } });
  process.stdout.write(`${JSON.stringify({ mode: run ? "run" : "summary", error, attempts, quarantined, overdue, pinUnknown, batch })}\n`);
  // Alert on anything a person must look at; a clean run exits 0.
  const attention = quarantined > 0 || pinUnknown > 0 || overdue > 0 || (batch && ((batch.statuses.BLOCKED ?? 0) > 0 || (batch.statuses.UNAVAILABLE ?? 0) > 0));
  if (attention && !process.exitCode) process.exitCode = 1;
} finally { await db.$disconnect(); }
