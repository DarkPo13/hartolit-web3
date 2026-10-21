import { verifyMessage, type Address, type Hex } from "viem";

// Deliberately local EIP-191 verification for EOA wallets, with no RPC fallback.
export async function verifyPublisherSignature(address: string, message: string, signature: string): Promise<boolean> {
  try { return await verifyMessage({ address: address as Address, message, signature: signature as Hex }); }
  catch { return false; }
}
