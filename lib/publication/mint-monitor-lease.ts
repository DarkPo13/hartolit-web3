import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { WorkflowError } from "@/lib/review/service";

/** Internal fencing token, never accepted in an HTTP DTO. The caller already
 * holds the passport lock, which also serializes claim/reclaim and completion.
 * Database wall time avoids cross-worker clock skew and transaction-start time.
 */
export type MintMonitorLease = { token: string };
export async function requireMintMonitorLease(tx: Prisma.TransactionClient, attemptId: string, lease?: MintMonitorLease) {
  if (!lease) return;
  const active = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "PublicationMintAttempt"
    WHERE "id" = ${attemptId}::uuid AND "monitorToken" = ${lease.token}::uuid
      AND "monitorUntil" > clock_timestamp()`;
  if (!active.length) throw new WorkflowError(409, "Mint monitoring lease expired or was replaced");
}
