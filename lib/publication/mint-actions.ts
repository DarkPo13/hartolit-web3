import "server-only";

import { getDb } from "@/lib/db";
import { createMintIntent, mintTransactionRequest, validateMintIntent } from "./chain-mint";
import { configuredMintTarget, mintConfigured } from "./mint-config";

/** Read-only mint state for the admin panel (D68). It computes the would-be intent
 * without locks or writes; every POST action rechecks authority, facts, storage and
 * the reviewed fingerprint under the passport lock. Chain fields here are public.
 */
export async function mintOverview(passportId: string) {
  const configured = mintConfigured();
  const publication = await getDb().publication.findFirst({
    where: { passportId, status: { in: ["PINNED", "CHAIN_PENDING", "CHAIN_SUSPENDED", "CHAIN_FAILED", "CHAIN_FAILED_SUSPENDED", "PUBLISHED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, canonicalJson: true, payloadHash: true, ipfsCid: true, confirmationId: true, passportVersion: true,
      mintPreparation: { select: { id: true, requestId: true, intentJson: true, intentSha256: true, createdAt: true,
        attempt: { select: { id: true, status: true, nonce: true, deadlineAt: true, unknownAt: true, finalizedAt: true, quarantinedAt: true,
          transactions: { select: { transactionHash: true }, orderBy: { createdAt: "asc" } },
          observations: { select: { reportedHash: true, status: true }, orderBy: { revision: "desc" }, take: 1 } } } } } },
  });
  if (!publication) return { configured, publication: null, candidate: null, preparation: null, attempt: null };
  const describe = async (intentInput: unknown) => {
    const intent = await validateMintIntent(intentInput);
    return { intent, request: await mintTransactionRequest(intent) };
  };
  let candidate = null;
  if (configured && publication.status === "PINNED" && !publication.mintPreparation && publication.ipfsCid) {
    try {
      const intent = await createMintIntent(configuredMintTarget(), { canonicalJson: publication.canonicalJson, payloadHash: publication.payloadHash, ipfsCid: publication.ipfsCid });
      candidate = await describe(intent);
    } catch { candidate = null; }
  }
  const saved = publication.mintPreparation;
  const attempt = saved?.attempt;
  return {
    configured,
    publication: { id: publication.id, status: publication.status, confirmationId: publication.confirmationId,
      passportVersion: publication.passportVersion, payloadHash: publication.payloadHash },
    candidate,
    preparation: saved ? { id: saved.id, requestId: saved.requestId, intentSha256: saved.intentSha256, createdAt: saved.createdAt.toISOString(),
      ...await describe(JSON.parse(saved.intentJson)) } : null,
    attempt: attempt ? { id: attempt.id, status: attempt.status, nonce: attempt.nonce.toString(), deadlineAt: attempt.deadlineAt.toISOString(),
      unknownAt: attempt.unknownAt?.toISOString() ?? null, finalizedAt: attempt.finalizedAt?.toISOString() ?? null, quarantined: !!attempt.quarantinedAt,
      transactionHashes: attempt.transactions.map(row => row.transactionHash), lastObservation: attempt.observations[0]?.status ?? null } : null,
  };
}
