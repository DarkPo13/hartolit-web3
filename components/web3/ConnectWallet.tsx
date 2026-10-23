"use client";

import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TARGET_CHAIN, TARGET_CHAIN_ID } from "@/lib/wagmi";
import { cn } from "@/lib/utils";

interface ConnectWalletProps {
  compact?: boolean;
  className?: string;
}

// Legacy demo control for the browser's injected wallet.
export function ConnectWallet({ compact, className }: ConnectWalletProps) {
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const size = compact ? "sm" : "md";

  return (
    <div className={cn(className)}>
      {!isConnected || !address ? (
        <Button
          onClick={() => connectors[0] && connect.mutate({ connector: connectors[0] })}
          disabled={!connectors[0] || connect.isPending}
          variant="primary"
          size={size}
          leadingIcon={<Wallet className="h-4 w-4" />}
        >
          Підключити гаманець
        </Button>
      ) : chainId !== TARGET_CHAIN_ID ? (
        <Button
          onClick={() => switchChain.mutate({ chainId: TARGET_CHAIN_ID })}
          disabled={switchChain.isPending}
          variant="danger"
          size={size}
          leadingIcon={<AlertTriangle className="h-4 w-4" />}
        >
          Невірна мережа
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          {!compact && <span className="font-mono text-xs text-ink-muted">{TARGET_CHAIN.name}</span>}
          <Button onClick={() => disconnect.mutate()} variant="secondary" size={size} className="font-mono text-xs">
            {`${address.slice(0, 6)}…${address.slice(-4)}`}
          </Button>
        </div>
      )}
    </div>
  );
}
