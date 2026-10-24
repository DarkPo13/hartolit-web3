import "server-only";

import { createPublicClient, defineChain, http } from "viem";
import { WorkflowError } from "@/lib/review/service";
import type { MintIntent } from "./chain-mint";

/** Server-only mint configuration (D68). The chain is BSC Testnet (97) only.
 * The RPC is HTTPS, or plain HTTP to a node on this machine. Nothing here comes
 * from a request; the publisher wallet is the existing allowlisted address.
 */
function rpcUrl() {
  const value = process.env.HARTOLIT_MINT_RPC_URL?.trim() ?? "";
  try {
    const url = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol === "https:" || (local && url.protocol === "http:")) && !url.username && !url.password && !url.hash) return url.toString();
  } catch { /* fall through */ }
  throw new WorkflowError(503, "Mint chain reader is not configured");
}

export function configuredMintTarget() {
  const wallet = (value: string | undefined) => value?.trim().toLowerCase() ?? "";
  const confirmations = Number(process.env.HARTOLIT_MINT_CONFIRMATIONS ?? "");
  // The intent schema validates every field again; this only gathers the values.
  return { chainId: 97, contractAddress: wallet(process.env.HARTOLIT_MINT_CONTRACT_ADDRESS),
    contractCodeHash: wallet(process.env.HARTOLIT_MINT_CONTRACT_CODE_HASH), publisherWallet: wallet(process.env.HARTOLIT_PUBLISHER_WALLET),
    recipientWallet: wallet(process.env.HARTOLIT_MINT_RECIPIENT_WALLET), requiredConfirmations: Number.isInteger(confirmations) ? confirmations : 0 };
}

const chain = (url: string) => defineChain({ id: 97, name: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 }, rpcUrls: { default: { http: [url] } } });

/** One read-only client for dispatch preflight, reports and monitoring. */
export function configuredMintReader() {
  const url = rpcUrl();
  return createPublicClient({ chain: chain(url), transport: http(url, { timeout: 10_000, retryCount: 0 }) });
}

export function configuredMintReaderFor(intent: MintIntent) {
  if (intent.chainId !== 97) throw new WorkflowError(503, "Unsupported mint chain");
  return configuredMintReader();
}

export function mintConfigured() {
  try { rpcUrl(); } catch { return false; }
  const target = configuredMintTarget();
  return /^0x[0-9a-f]{40}$/.test(target.contractAddress) && /^0x[0-9a-f]{64}$/.test(target.contractCodeHash) &&
    /^0x[0-9a-f]{40}$/.test(target.recipientWallet) && target.requiredConfirmations >= 2 && target.requiredConfirmations <= 256;
}
