"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: "#10b981",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
          })}
          appInfo={{
            appName: "Hartolit Field Passport",
            learnMoreUrl: "https://hartolit-agro.com",
          }}
          showRecentTransactions
        >
          {children}
          <Toaster
            position="top-right"
            theme="light"
            richColors
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  "!font-sans !rounded-xl !shadow-[var(--shadow-lifted)] !border !border-[var(--color-border)]",
              },
            }}
          />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
