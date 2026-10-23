import "server-only";

import { cache } from "react";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { createRawGatewayReader } from "@/lib/publication/ipfs-reader";
import { boundedMintMonitorReader } from "@/lib/publication/mint-reader";
import { verifyPublicPassport, type PublicVerification, type PublicVerifierReader } from "./verify";

const loopback = /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\/?$/;

/** HTTPS, or plain HTTP to a node on this machine; never credentials or query. */
function trustedUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if ((url.protocol !== "https:" && !loopback.test(value!)) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

/** The only reader of verifier configuration. Unset or malformed values make
 * every request UNAVAILABLE/NOT_CONFIGURED; there is no default network.
 */
function dependencies() {
  const rpc = trustedUrl(process.env.HARTOLIT_VERIFY_RPC_URL), gateway = trustedUrl(process.env.HARTOLIT_VERIFY_GATEWAY_URL);
  const confirmations = process.env.HARTOLIT_VERIFY_CONFIRMATIONS ?? "";
  if (!rpc || !gateway || !/^[1-9][0-9]{0,2}$/.test(confirmations)) return null;
  try {
    const client = createPublicClient({ chain: bscTestnet, transport: http(rpc.toString(), { timeout: 5_000, retryCount: 0 }) });
    return {
      target: { chainId: 97, contractAddress: process.env.HARTOLIT_VERIFY_CONTRACT_ADDRESS,
        contractCodeHash: process.env.HARTOLIT_VERIFY_CONTRACT_CODE_HASH, requiredConfirmations: Number(confirmations) },
      reader: boundedMintMonitorReader(client),
      readBlock: createRawGatewayReader(gateway.toString(), fetch, { loopbackHttp: true }),
    };
  } catch { return null; }
}

/** Request-deduplicated public verification; returns a public-only DTO. */
export const verifyConfiguredPassport = cache(async (tokenId: string): Promise<PublicVerification> => {
  const configured = dependencies();
  // An invalid target is refused before any read, so these are never called.
  if (!configured) return verifyPublicPassport(tokenId, null, {} as PublicVerifierReader, async () => { throw new Error(); });
  return verifyPublicPassport(tokenId, configured.target, configured.reader, configured.readBlock);
});
