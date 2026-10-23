import "server-only";

import { z } from "zod";
import type { Prisma, PublicationMintCancellation } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { canonicalize, sha256Hex } from "@/lib/hash";
import { WorkflowError } from "@/lib/review/service";
import { publicationPublisherAccess } from "./service";
import { lockDispatchedMint } from "./mint-observation";
import { mintWalletHistory, verifyMintWalletAnchors } from "./mint-wallet";
import { inspectMintCancellation } from "./mint-cancellation";
import type { MintReader } from "./chain-mint";
import { boundedMintMonitorReader } from "./mint-reader";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const inputSchema = z.strictObject({ requestId: z.uuid(), discoveryId: z.uuid(), expectedIntentSha256: sha,
  expectedWalletStateSha256: sha, expectedObservationVersion: z.number().int().nonnegative(),
  expectedDiscoveryVersion: z.number().int().positive(), acknowledgement: z.literal("CLOSE_CANCELLED_MINT") });
type Input = z.infer<typeof inputSchema>;

async function authority(tx: Prisma.TransactionClient, adminId: string, wallet?: string) {
  const access = publicationPublisherAccess(adminId);
  if (!access.configured || !access.canProve || !access.walletAddress || (wallet && access.walletAddress !== wallet) ||
    !await tx.user.findFirst({ where: { id: adminId, role: "admin", banned: false, twoFactorEnabled: true }, select: { id: true } })) {
    throw new WorkflowError(403, "Cancellation closure requires the current designated MFA publisher and wallet");
  }
}
async function load(tx: Prisma.TransactionClient, adminId: string, passportId: string, attemptId: string, discoveryId: string) {
  await authority(tx, adminId);
  const current = await lockDispatchedMint(tx, passportId, attemptId);
  const discovery = await tx.publicationMintDiscovery.findFirst({ where: { id: discoveryId, attemptId, status: "CONFLICT" } });
  if (!discovery || !discovery.transactionHash || discovery.transactionId || discovery.fromBlock === null || discovery.throughBlock === null ||
    !discovery.throughBlockHash || discovery.headBlock === null || !discovery.headBlockHash ||
    current.attempt.dispatchBlockNumber === null || !current.attempt.dispatchBlockHash || discovery.revision !== current.attempt.discoveryVersion ||
    discovery.fromBlock <= current.attempt.dispatchBlockNumber) throw new WorkflowError(409, "The latest anchored nonce conflict is required");
  await authority(tx, adminId, current.attempt.publisherWallet);
  return { ...current, discovery };
}
async function pending(tx: Prisma.TransactionClient, adminId: string, current: Awaited<ReturnType<typeof load>>) {
  if (current.finalized || current.failed) throw new WorkflowError(409, "Closed mint attempts cannot be closed again or resent");
  const history = await mintWalletHistory(tx, current.attempt.chainId, current.attempt.publisherWallet);
  await authority(tx, adminId, current.attempt.publisherWallet);
  const walletStateSha256 = await sha256Hex(canonicalize({ history: history.binding, commitment: current.binding,
    observationVersion: current.attempt.observationVersion, discoveryVersion: current.attempt.discoveryVersion,
    discovery: { id: current.discovery.id, revision: current.discovery.revision, hash: current.discovery.transactionHash,
      from: current.discovery.fromBlock!.toString(), through: current.discovery.throughBlock!.toString(), blockHash: current.discovery.throughBlockHash,
      head: current.discovery.headBlock!.toString(), headHash: current.discovery.headBlockHash } }));
  return { ...current, history, walletStateSha256 };
}
function requireReview(current: Awaited<ReturnType<typeof pending>>, data: Input) {
  if (current.intent.sha256 !== data.expectedIntentSha256 || current.walletStateSha256 !== data.expectedWalletStateSha256 ||
    current.attempt.observationVersion !== data.expectedObservationVersion || current.attempt.discoveryVersion !== data.expectedDiscoveryVersion) {
    throw new WorkflowError(409, "Cancellation review changed; inspect the current conflict again");
  }
}
function matches(row: PublicationMintCancellation, adminId: string, attemptId: string, data: Input) {
  return row.actorId === adminId && row.attemptId === attemptId && row.discoveryId === data.discoveryId && row.intentSha256 === data.expectedIntentSha256 &&
    row.walletStateSha256 === data.expectedWalletStateSha256 && row.reviewedObservationVersion === data.expectedObservationVersion &&
    row.reviewedDiscoveryVersion === data.expectedDiscoveryVersion;
}
const recorded = (row: PublicationMintCancellation, quarantined: boolean) => ({ status: "RECORDED" as const, cancellationId: row.id,
  closedAt: row.closedAt.toISOString(), currentlyQuarantined: quarantined, issued: false as const, canResend: false as const });

/** Internal consent review, never a send command. Future routes must authenticate session/origin. */
export async function getMintCancellationReview(adminId: string, passportId: string, attemptId: string, discoveryId: string) {
  return getDb().$transaction(async tx => {
    const current = await pending(tx, adminId, await load(tx, adminId, passportId, attemptId, discoveryId));
    return { discoveryId, intentSha256: current.intent.sha256, walletStateSha256: current.walletStateSha256,
      observationVersion: current.attempt.observationVersion, discoveryVersion: current.attempt.discoveryVersion,
      transactionHash: current.discovery.transactionHash!, nonce: current.attempt.nonce.toString(), issued: false as const, canResend: false as const };
  });
}

/** Release only an active slot after fresh canonical same-nonce self-send proof.
 * Original preparation/request/nonce remain permanent. No broadcaster or retry.
 */
export async function closeCancelledMint(adminId: string, passportId: string, attemptId: string, input: unknown, trustedReader: MintReader) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError(422, "Exact cancellation review and separate acknowledgement are required");
  const data = parsed.data;
  const before = await getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, data.discoveryId);
    const existing = await tx.publicationMintCancellation.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Cancellation request belongs to another review");
      return { recorded: recorded(existing, !!current.attempt.quarantinedAt) };
    }
    const candidate = await pending(tx, adminId, current); requireReview(candidate, data); return { candidate };
  });
  if (before.recorded) return before.recorded;
  const candidate = before.candidate!, startedAt = Date.now(), reader = boundedMintMonitorReader(trustedReader);
  let result;
  try {
    const head = await verifyMintWalletAnchors(candidate.history.anchors, reader);
    const anchor = await reader.getBlock({ blockNumber: candidate.attempt.dispatchBlockNumber! });
    const searchedHead = await reader.getBlock({ blockNumber: candidate.discovery.headBlock! });
    if (anchor.number !== candidate.attempt.dispatchBlockNumber || anchor.hash !== candidate.attempt.dispatchBlockHash ||
      searchedHead.number !== candidate.discovery.headBlock || searchedHead.hash !== candidate.discovery.headBlockHash) throw new Error();
    result = await inspectMintCancellation(candidate.intent, candidate.discovery.transactionHash!, candidate.attempt.nonce, reader);
    if (head && ((await reader.getBlock({ blockNumber: head.number })).hash !== head.hash || await reader.getChainId() !== 97)) throw new Error();
    const again = await reader.getBlock({ blockNumber: candidate.attempt.dispatchBlockNumber! });
    const searchedAgain = await reader.getBlock({ blockNumber: candidate.discovery.headBlock! });
    if (again.hash !== anchor.hash || again.number !== anchor.number || searchedAgain.number !== searchedHead.number || searchedAgain.hash !== searchedHead.hash) throw new Error();
  } catch { throw new WorkflowError(503, "Cancellation proof could not be freshly verified; wallet slot remains held"); }
  if (result.status !== "CANCELLED" || result.blockNumber !== candidate.discovery.throughBlock!.toString() ||
    result.blockHash !== candidate.discovery.throughBlockHash || BigInt(result.headBlockNumber) < candidate.discovery.headBlock!) {
    throw new WorkflowError(409, "Only the sufficiently confirmed unchanged discovered cancellation releases this slot");
  }
  return getDb().$transaction(async tx => {
    const current = await load(tx, adminId, passportId, attemptId, data.discoveryId);
    const existing = await tx.publicationMintCancellation.findUnique({ where: { requestId: data.requestId } });
    if (existing) {
      if (!matches(existing, adminId, attemptId, data)) throw new WorkflowError(409, "Cancellation request belongs to another review");
      return recorded(existing, !!current.attempt.quarantinedAt);
    }
    const fresh = await pending(tx, adminId, current); requireReview(fresh, data);
    if (fresh.binding !== candidate.binding || Date.now() < startedAt || Date.now() - startedAt >= 15_000) throw new WorkflowError(409, "Cancellation proof expired or commitment changed");
    const observation = await tx.publicationMintObservation.create({ data: { attemptId, revision: fresh.attempt.observationVersion + 1,
      reportedHash: fresh.discovery.transactionHash, status: "CANCELLED", resultJson: canonicalize({ version: 1, proofKind: "CANCELLATION", ...result }) } });
    const cancellation = await tx.publicationMintCancellation.create({ data: { attemptId, requestId: data.requestId, actorId: adminId,
      discoveryId: fresh.discovery.id, transactionHash: fresh.discovery.transactionHash!, observationId: observation.id,
      reviewedObservationVersion: data.expectedObservationVersion, reviewedDiscoveryVersion: data.expectedDiscoveryVersion,
      intentSha256: data.expectedIntentSha256, walletStateSha256: data.expectedWalletStateSha256, closedAt: observation.observedAt } });
    await tx.publicationMintAttempt.update({ where: { id: attemptId }, data: { status: "FAILED_TERMINAL", failedAt: observation.observedAt,
      failedObservationId: observation.id, failureStatus: "CANCELLED", observationVersion: observation.revision } });
    await tx.publication.update({ where: { id: fresh.publication.id }, data: { status: "CHAIN_FAILED" } });
    const previous = await tx.publicationMintResult.findUnique({ where: { attemptId } });
    const selected = { status: "SUSPENDED" as const, checkedObservationId: observation.id, verifiedObservationId: previous?.verifiedObservationId ?? null,
      verificationStatus: previous?.verifiedObservationId ? "VERIFIED" as const : null };
    await tx.publicationMintResult.upsert({ where: { attemptId }, create: { attemptId, ...selected }, update: selected });
    await tx.auditLog.create({ data: { passportId, publicationId: fresh.publication.id, actorId: adminId, version: fresh.publication.passportVersion,
      action: "PUBLICATION_MINT_CANCELLED", fromStatus: "APPROVED", toStatus: "APPROVED", note: `Cancelled mint closure: ${cancellation.id}` } });
    return recorded(cancellation, false);
  });
}
