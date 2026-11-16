// Delivers queued password reset and invitation emails (D81) until nothing is due, then
// prints one JSON line of counts. For a separate worker or scheduler; a long-running
// `next start` also delivers right after each request. Exit 0: nothing failed. Exit 1: an
// attempt failed (retried later) or was given up. Exit 2: SMTP is not configured.
// Never prints an address, link or token.
import path from "node:path";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ drainPasswordResetOutbox, OUTBOX_BATCH }, { isResetEmailConfigured }, { getDb }] = await Promise.all([
  jiti.import("../lib/password-reset-outbox.ts"), jiti.import("../lib/reset-email.ts"), jiti.import("../lib/db-core.ts")]);

if (!isResetEmailConfigured()) {
  process.stdout.write(`${JSON.stringify({ configured: false })}\n`);
  process.exit(2);
}
const total = { sent: 0, retried: 0, gaveUp: 0, expired: 0, decoys: 0, discarded: 0 };
try {
  for (let batch = 0; batch < 50; batch++) {
    const counts = await drainPasswordResetOutbox();
    for (const key of Object.keys(total)) total[key] += counts[key];
    if (counts.sent + counts.retried + counts.gaveUp + counts.decoys + counts.discarded < OUTBOX_BATCH) break;
  }
  total.pending = await getDb().passwordResetOutbox.count();
} finally {
  await getDb().$disconnect();
}
process.stdout.write(`${JSON.stringify(total)}\n`);
process.exit(total.retried || total.gaveUp ? 1 : 0);
