import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { bscTestnet } from "wagmi/chains";

// One in-memory browser-wallet session for the lazily loaded publisher modules
// (ownership proof and mint send). Do not recreate injected provider listeners
// when navigating between passports; nothing is persisted (D30).
export const publisherConfig = createConfig({ chains: [bscTestnet], connectors: [injected()],
  multiInjectedProviderDiscovery: false, storage: null, ssr: false,
  transports: { [bscTestnet.id]: http(process.env.NEXT_PUBLIC_BSC_TESTNET_RPC) },
});

/** A user refusal in the wallet (EIP-1193 code 4001), however the library wraps it. */
export function rejectedByWallet(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === 4001) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
