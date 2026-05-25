"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ConnectWalletProps {
  compact?: boolean;
  className?: string;
}

export function ConnectWallet({ compact, className }: ConnectWalletProps) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        return (
          <div
            className={cn(className)}
            {...(!ready && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none", userSelect: "none" },
            })}
          >
            {!connected ? (
              <Button
                onClick={openConnectModal}
                variant="primary"
                size={compact ? "sm" : "md"}
                leadingIcon={<Wallet className="h-4 w-4" />}
              >
                Підключити гаманець
              </Button>
            ) : chain.unsupported ? (
              <Button
                onClick={openChainModal}
                variant="danger"
                size={compact ? "sm" : "md"}
                leadingIcon={<AlertTriangle className="h-4 w-4" />}
              >
                Невірна мережа
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  onClick={openChainModal}
                  variant="secondary"
                  size={compact ? "sm" : "md"}
                  className="font-mono text-xs"
                >
                  {chain.hasIcon && chain.iconUrl && (
                    <img
                      src={chain.iconUrl}
                      alt={chain.name}
                      className="h-4 w-4 rounded-full"
                    />
                  )}
                  {compact ? "" : chain.name}
                </Button>
                <Button
                  onClick={openAccountModal}
                  variant="secondary"
                  size={compact ? "sm" : "md"}
                  className="font-mono text-xs"
                >
                  {account.displayName}
                  {!compact && account.displayBalance ? ` · ${account.displayBalance}` : ""}
                </Button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
