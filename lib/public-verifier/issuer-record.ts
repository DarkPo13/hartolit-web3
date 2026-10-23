import "server-only";

import { getDb } from "@/lib/db";

export type IssuerRecordNotice = "MATCH" | "SUSPENDED" | "DISAGREES" | "NO_RECORD" | "UNAVAILABLE";
type Row = { status: string; payloadHash: string; ipfsCid: string | null; chainId: number | null; contractAddress: string | null; tokenId: string | null };
type Lookup = { publication: { findUnique(args: unknown): Promise<Row | null> } };
const select = { status: true, payloadHash: true, ipfsCid: true, chainId: true, contractAddress: true, tokenId: true } as const;

/** Display-only enrichment for an already VALID public verification. It can add
 * a warning or a matching note; it never changes, replaces or skips the chain/IPFS
 * verdict, and it returns only a coarse kind, never private record data.
 */
export async function issuerRecordNotice(verified: { tokenId: string; contractAddress: string; payloadHash: string; cid: string },
  lookup?: Lookup, timeoutMs = 2_000): Promise<IssuerRecordNotice> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Inside try: missing database configuration is UNAVAILABLE, not a page error.
    const db = lookup ?? getDb() as unknown as Lookup;
    const [byToken, byHash] = await Promise.race([
      Promise.all([
        db.publication.findUnique({ where: { chainId_contractAddress_tokenId: { chainId: 97, contractAddress: verified.contractAddress, tokenId: verified.tokenId } }, select }),
        db.publication.findUnique({ where: { payloadHash: verified.payloadHash }, select }),
      ]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("issuer record timeout")), timeoutMs); }),
    ]);
    // The same committed document recorded against another token or contract.
    if (byHash && (byHash.chainId !== 97 || byHash.contractAddress !== verified.contractAddress || byHash.tokenId !== verified.tokenId) &&
      byHash.status === "PUBLISHED") return "DISAGREES";
    if (!byToken) return byHash ? "SUSPENDED" : "NO_RECORD";
    if (byToken.payloadHash !== verified.payloadHash || byToken.ipfsCid !== verified.cid) return "DISAGREES";
    return byToken.status === "PUBLISHED" ? "MATCH" : "SUSPENDED";
  } catch { return "UNAVAILABLE"; }
  finally { clearTimeout(timer); }
}
