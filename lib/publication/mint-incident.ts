import "server-only";

import { z } from "zod";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import type { MintReader } from "./chain-mint";
import { closeRevertedMint, getMintFailureReview } from "./mint-failure";
import { adoptReincludedMintAnchor, getMintCancellationRecoveryReview, getMintFailureRecoveryReview, getMintReanchorReview,
  getMintRecoveryReview, restoreCancelledMint, restoreFailedMint, restoreOriginalMint } from "./mint-recovery";

/** Which reviewed resolution (D43-D45, D49, D50) applies to an attempt right now.
 * Classification only reads saved state; every action re-checks it with fresh RPC.
 */
async function classify(passportId: string, attemptId: string) {
  const attempt = await getDb().publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId } } },
    select: { status: true, quarantinedAt: true, finalizedAt: true, failureStatus: true,
      observations: { select: { status: true, transactionId: true }, orderBy: { revision: "desc" }, take: 1 } } });
  if (!attempt) throw new WorkflowError(404, "Mint attempt not found");
  if (attempt.quarantinedAt) {
    const closed = attempt.finalizedAt ? "SUCCESS" as const : attempt.failureStatus === "REVERTED" ? "FAILURE" as const
      : attempt.failureStatus === "CANCELLED" ? "CANCELLATION" as const : null;
    if (!closed) throw new WorkflowError(409, "This quarantine has no reviewed resolution in the app");
    return { kind: "QUARANTINE" as const, closed };
  }
  const last = attempt.observations[0];
  if (["DISPATCHING", "UNKNOWN"].includes(attempt.status) && last?.status === "REVERTED" && last.transactionId) {
    return { kind: "REVERTED" as const, transactionId: last.transactionId };
  }
  throw new WorkflowError(409, "No mint incident needs review");
}

export async function getMintIncident(adminId: string, passportId: string, attemptId: string) {
  const incident = await classify(passportId, attemptId);
  if (incident.kind === "REVERTED") return { kind: incident.kind, review: await getMintFailureReview(adminId, passportId, attemptId, incident.transactionId) };
  const restore = incident.closed === "SUCCESS" ? await getMintRecoveryReview(adminId, passportId, attemptId)
    : incident.closed === "FAILURE" ? await getMintFailureRecoveryReview(adminId, passportId, attemptId)
      : await getMintCancellationRecoveryReview(adminId, passportId, attemptId);
  return { kind: incident.kind, closed: incident.closed, restore, reanchor: await getMintReanchorReview(adminId, passportId, attemptId)
    .catch(error => { if (error instanceof WorkflowError && error.status === 409) return null; throw error; }) };
}

const action = z.enum(["CLOSE_REVERTED", "RESTORE", "REANCHOR"]);

/** Routes one reviewed action to its service; the service validates the exact review and acknowledgement. */
export async function resolveMintIncident(adminId: string, passportId: string, attemptId: string, requested: unknown, input: unknown, reader: MintReader) {
  const parsed = action.safeParse(requested);
  if (!parsed.success) throw new WorkflowError(422, "Unknown incident action");
  const incident = await classify(passportId, attemptId);
  if (parsed.data === "CLOSE_REVERTED") {
    if (incident.kind !== "REVERTED") throw new WorkflowError(409, "Only a reverted open mint can be closed this way");
    return closeRevertedMint(adminId, passportId, attemptId, input, reader);
  }
  if (incident.kind !== "QUARANTINE") throw new WorkflowError(409, "Only a quarantined closed mint can be restored or re-anchored");
  if (parsed.data === "REANCHOR") return adoptReincludedMintAnchor(adminId, passportId, attemptId, input, reader);
  return incident.closed === "SUCCESS" ? restoreOriginalMint(adminId, passportId, attemptId, input, reader)
    : incident.closed === "FAILURE" ? restoreFailedMint(adminId, passportId, attemptId, input, reader)
      : restoreCancelledMint(adminId, passportId, attemptId, input, reader);
}
