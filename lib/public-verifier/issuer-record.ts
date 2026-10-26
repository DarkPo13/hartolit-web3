import "server-only";

import { getDb } from "@/lib/db";

export type IssuerRecordKind = "MATCH" | "SUSPENDED" | "DISAGREES" | "NO_RECORD" | "UNAVAILABLE";
/** `supersededBy.tokenId` is null while the correction is not yet published. */
export type IssuerRecordNotice = { kind: IssuerRecordKind; supersededBy: { tokenId: string | null } | null; corrects: string | null };
type Row = { id: string; passportId: string; status: string; payloadHash: string; ipfsCid: string | null; chainId: number | null; contractAddress: string | null; tokenId: string | null };
type Lookup = {
  publication: { findUnique(args: unknown): Promise<Row | null>; findFirst(args: unknown): Promise<Row | { tokenId: string | null } | null> };
  publicationCorrection: { findUnique(args: unknown): Promise<{ correctionPassportId?: string; supersededPublication?: { tokenId: string | null } } | null> };
};
const select = { id: true, passportId: true, status: true, payloadHash: true, ipfsCid: true, chainId: true, contractAddress: true, tokenId: true } as const;
const quiet = (kind: IssuerRecordKind): IssuerRecordNotice => ({ kind, supersededBy: null, corrects: null });

// A record published again after a cancelled or reverted mint keeps the failed row as history:
// prefer the open publication, else the latest failed one (it still signals "never issued").
async function byPayload(db: Lookup, payloadHash: string) {
  const open = await db.publication.findFirst({ where: { payloadHash, status: { notIn: ["CHAIN_FAILED", "CHAIN_FAILED_SUSPENDED"] } }, select }) as Row | null;
  return open ?? await db.publication.findFirst({ where: { payloadHash }, orderBy: { createdAt: "desc" }, select }) as Row | null;
}

function kindOf(verified: { tokenId: string; contractAddress: string; payloadHash: string; cid: string }, byToken: Row | null, byHash: Row | null): IssuerRecordKind {
  // The same committed document recorded against another token or contract.
  if (byHash && (byHash.chainId !== 97 || byHash.contractAddress !== verified.contractAddress || byHash.tokenId !== verified.tokenId) &&
    byHash.status === "PUBLISHED") return "DISAGREES";
  if (!byToken) return byHash ? "SUSPENDED" : "NO_RECORD";
  if (byToken.payloadHash !== verified.payloadHash || byToken.ipfsCid !== verified.cid) return "DISAGREES";
  return byToken.status === "PUBLISHED" ? "MATCH" : "SUSPENDED";
}

/** Display-only enrichment for an already VALID public verification. It can add
 * a warning, a matching note or a correction link; it never changes, replaces or
 * skips the chain/IPFS verdict, and returns only coarse kinds and public token IDs.
 */
export async function issuerRecordNotice(verified: { tokenId: string; contractAddress: string; payloadHash: string; cid: string },
  lookup?: Lookup, timeoutMs = 2_000): Promise<IssuerRecordNotice> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("issuer record timeout")), timeoutMs); });
  try {
    // Inside try: missing database configuration is UNAVAILABLE, not a page error.
    const db = lookup ?? getDb() as unknown as Lookup;
    return await Promise.race([timeout, (async () => {
      const [byToken, byHash] = await Promise.all([
        db.publication.findUnique({ where: { chainId_contractAddress_tokenId: { chainId: 97, contractAddress: verified.contractAddress, tokenId: verified.tokenId } }, select }),
        byPayload(db, verified.payloadHash),
      ]);
      const kind = kindOf(verified, byToken, byHash);
      if (!byToken || kind === "DISAGREES") return quiet(kind);
      const [superseding, correcting] = await Promise.all([
        db.publicationCorrection.findUnique({ where: { supersededPublicationId: byToken.id }, select: { correctionPassportId: true } }),
        db.publicationCorrection.findUnique({ where: { correctionPassportId: byToken.passportId }, select: { supersededPublication: { select: { tokenId: true } } } }),
      ]);
      const replacement = superseding?.correctionPassportId ? await db.publication.findFirst({ where: { passportId: superseding.correctionPassportId,
        status: "PUBLISHED", chainId: 97, contractAddress: verified.contractAddress }, select: { tokenId: true } }) : null;
      return { kind, supersededBy: superseding ? { tokenId: replacement?.tokenId ?? null } : null, corrects: correcting?.supersededPublication?.tokenId ?? null };
    })()]);
  } catch { return quiet("UNAVAILABLE"); }
  finally { clearTimeout(timer); }
}
