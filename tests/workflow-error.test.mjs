import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });

test("workflow errors retain their identity through service and alias imports used by monitor leases", async () => {
  const { WorkflowError } = await jiti.import("../lib/review/service.ts");
  const { WorkflowError: alias } = await jiti.import("@/lib/review/service");
  const { requireMintMonitorLease } = await jiti.import("../lib/publication/mint-monitor-lease.ts");
  assert.equal(WorkflowError, alias);
  await assert.rejects(requireMintMonitorLease({ $queryRaw: async () => [] }, "fictional-attempt", { token: "fictional-token" }),
    error => error instanceof WorkflowError && error.status === 409);
  const isolated = createJiti(import.meta.url, { moduleCache: false, alias: { "@": process.cwd().replaceAll("\\", "/"),
    "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
  const { WorkflowError: copy } = await isolated.import("../lib/review/errors.ts");
  assert.notEqual(copy, WorkflowError);
  assert.ok(new copy(409, "Fictional expired lease") instanceof WorkflowError);
  assert.equal(Object.assign(new Error("not a domain error"), { status: 409 }) instanceof WorkflowError, false);
});
