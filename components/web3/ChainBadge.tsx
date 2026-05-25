"use client";

import { TARGET_CHAIN } from "@/lib/wagmi";
import { Badge } from "@/components/ui/Badge";

export function ChainBadge() {
  const isTestnet = TARGET_CHAIN.id !== 56;
  return (
    <Badge tone={isTestnet ? "warning" : "success"} className="gap-2">
      <span className="pulse-dot" aria-hidden />
      <span className="hash-mono">
        {TARGET_CHAIN.name} · chainId {TARGET_CHAIN.id}
      </span>
    </Badge>
  );
}
