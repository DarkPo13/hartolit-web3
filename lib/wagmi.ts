import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { bsc, bscTestnet } from "wagmi/chains";
import { http } from "wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);

if (!projectId && typeof window !== "undefined") {
  console.warn(
    "[wagmi] NEXT_PUBLIC_WALLETCONNECT_ID is not set — wallet connection will be limited. " +
      "Get a free one at https://cloud.reown.com",
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "Hartolit Field Passport",
  appDescription: "On-chain certificates for agricultural drone treatments",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://dapp.hartolit-agro.com",
  projectId: projectId ?? "REPLACE_ME_WALLETCONNECT_PROJECT_ID",
  chains: targetChainId === 56 ? [bsc, bscTestnet] : [bscTestnet, bsc],
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
