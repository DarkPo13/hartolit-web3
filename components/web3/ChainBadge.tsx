"use client";

import { Badge } from "@/components/ui/Badge";

export function ChainBadge() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);
  const isTestnet = chainId !== 56;
  return (
    <Badge tone={isTestnet ? "warning" : "success"} className="gap-2">
      <span className="pulse-dot" aria-hidden />
      <span className="hash-mono">
        {isTestnet ? "BNB Smart Chain Testnet" : "BNB Smart Chain"} · chainId {chainId}
      </span>
    </Badge>
  );
}
