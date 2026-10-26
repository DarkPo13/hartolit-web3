import "server-only";

import { z } from "zod";
import type { PublicClient } from "viem";
import { getDb } from "@/lib/db";
import { WorkflowError } from "@/lib/review/service";
import type { MintReader } from "./chain-mint";
import { closeRevertedMint, getMintFailureReview } from "./mint-failure";
import { adoptReincludedMintAnchor, getMintCancellationRecoveryReview, getMintFailureRecoveryReview, getMintReanchorReview,
  getMintRecoveryReview, restoreCancelledMint, restoreFailedMint, restoreOriginalMint } from "./mint-recovery";
import { approveMintReopen, foreignNonceTransaction, mintReopenState, proposeMintReopen, withdrawMintReopen } from "./mint-reopen";

type IncidentReader = MintReader & Pick<PublicClient, "getTransactionCount">;

/** Which reviewed resolution (D43-D45, D49, D50, D75) applies to an attempt right now.
 * Classification only reads saved state; every action re-checks it with fresh RPC.
 */
async function classify(passportId: string, attemptId: string) {
  const attempt = await getDb().publicationMintAttempt.findFirst({ where: { id: attemptId, preparation: { publication: { passportId } } },
    select: { status: true, quarantinedAt: true, finalizedAt: true, failureStatus: true, discoveryVersion: true,
      observations: { select: { status: true, transactionId: true }, orderBy: { revision: "desc" }, take: 1 },
      discoveries: { select: { status: true, revision: true }, orderBy: { revision: "desc" }, take: 1 } } });
  if (!attempt) throw new WorkflowError(404, "Mint attempt not found");
  if (attempt.quarantinedAt) {
    const closed = attempt.finalizedAt ? "SUCCESS" as const : attempt.failureStatus === "REVERTED" ? "FAILURE" as const
      : attempt.failureStatus === "CANCELLED" ? "CANCELLATION" as const : null;
    if (!closed) throw new WorkflowError(409, "This quarantine has no reviewed resolution in the app");
    return { kind: "QUARANTINE" as const, closed };
  }
  const open = ["DISPATCHING", "UNKNOWN"].includes(attempt.status);
  const last = attempt.observations[0], search = attempt.discoveries[0];
  if (open && last?.status === "REVERTED" && last.transactionId) return { kind: "REVERTED" as const, transactionId: last.transactionId };
  // The dispatch anchor may have left the canonical chain (class "changed dispatch anchor").
  if (open && search?.revision === attempt.discoveryVersion && search.status === "REORG") return { kind: "PENDING_REORG" as const };
  if (open && search?.revision === attempt.discoveryVersion && search.status === "CONFLICT") return { kind: "CONFLICT" as const };
  throw new WorkflowError(409, "No mint incident needs review");
}

// Reviews that only the designated publisher may load are null for other administrators,
// who still see the incident and can approve a reopening (D75).
const forPublisher = <T,>(review: Promise<T>) => review.catch(error => {
  if (error instanceof WorkflowError && (error.status === 403 || error.status === 409)) return null; throw error;
});

export async function getMintIncident(adminId: string, passportId: string, attemptId: string, reader: MintReader) {
  const incident = await classify(passportId, attemptId);
  const reopen = await mintReopenState(passportId, attemptId);
  const proposal = reopen.proposal ? { ...reopen.proposal, ownProposal: reopen.proposal.proposedById === adminId, proposedById: undefined } : null;
  if (incident.kind === "REVERTED") return { kind: incident.kind, review: await forPublisher(getMintFailureReview(adminId, passportId, attemptId, incident.transactionId)), proposal };
  if (incident.kind === "PENDING_REORG") return { kind: incident.kind, proposal };
  if (incident.kind === "CONFLICT") {
    // A conflicting transaction that is not a zero-value self-send: possible wallet compromise, runbook only.
    const foreign = await foreignNonceTransaction(passportId, attemptId, reader);
    if (!foreign) throw new WorkflowError(409, "No mint incident needs review");
    return { kind: "FOREIGN_NONCE" as const, transactionHash: foreign, proposal: null };
  }
  const restore = incident.closed === "SUCCESS" ? await forPublisher(getMintRecoveryReview(adminId, passportId, attemptId))
    : incident.closed === "FAILURE" ? await forPublisher(getMintFailureRecoveryReview(adminId, passportId, attemptId))
      : await forPublisher(getMintCancellationRecoveryReview(adminId, passportId, attemptId));
  return { kind: incident.kind, closed: incident.closed, restore, reanchor: await forPublisher(getMintReanchorReview(adminId, passportId, attemptId)), proposal };
}

const action = z.enum(["CLOSE_REVERTED", "RESTORE", "REANCHOR", "PROPOSE_REOPEN", "APPROVE_REOPEN", "WITHDRAW_REOPEN"]);

/** Routes one reviewed action to its service; the service validates the exact review and acknowledgement. */
export async function resolveMintIncident(adminId: string, passportId: string, attemptId: string, requested: unknown, input: unknown, reader: IncidentReader) {
  const parsed = action.safeParse(requested);
  if (!parsed.success) throw new WorkflowError(422, "Unknown incident action");
  if (parsed.data === "PROPOSE_REOPEN") return proposeMintReopen(adminId, passportId, attemptId, input, reader);
  if (parsed.data === "APPROVE_REOPEN") return approveMintReopen(adminId, passportId, attemptId, input, reader);
  if (parsed.data === "WITHDRAW_REOPEN") return withdrawMintReopen(adminId, passportId, attemptId, input);
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
