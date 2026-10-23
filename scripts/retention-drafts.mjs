// Unused-draft retention (D25, D60). Dry run by default: prints counts only.
// --notify emails owners of eligible drafts; --execute deletes drafts whose sent
// notice period has passed. Preservation holds and correction drafts are never touched.
import path from "node:path";
import nextEnv from "@next/env";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const notify = process.argv.includes("--notify"), execute = process.argv.includes("--execute");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { draftRetentionPlan, sendDraftNotices, deleteNoticedDrafts } = await jiti.import("../lib/retention/drafts.ts");
const { getDb } = await jiti.import("../lib/db-core.ts");
try {
  const notices = notify ? await sendDraftNotices() : null;
  const deletion = execute ? await deleteNoticedDrafts() : null;
  const plan = await draftRetentionPlan();
  const summary = { mode: execute || notify ? [notify && "notify", execute && "execute"].filter(Boolean).join("+") : "dry-run",
    needsNotice: plan.needsNotice.length, waiting: plan.waiting.length, deletable: plan.deletable.length, notices, deletion };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  // A scheduler should alert when an owner could not be notified or a deletion was skipped.
  if ((notices?.failed ?? 0) > 0 || (deletion?.skipped ?? 0) > 0) process.exitCode = 1;
} finally { await getDb().$disconnect(); }
