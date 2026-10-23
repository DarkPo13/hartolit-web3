import { createConfig, http } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);

// Legacy demo only: the browser's injected wallet, no WalletConnect or third-party SDKs.
export const wagmiConfig = createConfig({
  chains: targetChainId === 56 ? [bsc, bscTestnet] : [bscTestnet, bsc],
  connectors: [injected()],
  transports: {
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC ?? "https://bsc-rpc.publicnode.com"),
    [bscTestnet.id]: http(
      process.env.NEXT_PUBLIC_BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    ),
  },
  ssr: true,
});

export const TARGET_CHAIN_ID = targetChainId;
export const TARGET_CHAIN = targetChainId === 56 ? bsc : bscTestnet;
