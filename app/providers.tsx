"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import "@rainbow-me/rainbowkit/styles.css";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/lib/i18n/context";
import { isDemoMode } from "@/lib/demo-mode";

const DemoWeb3Providers = dynamic(() => import("./DemoWeb3Providers").then((module) => module.DemoWeb3Providers), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      {isDemoMode() ? <DemoWeb3Providers>{children}</DemoWeb3Providers> : children}
      <Toaster
        position="top-right"
        theme="light"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "!font-sans !rounded-xl !shadow-[var(--shadow-lifted)] !border !border-[var(--color-border)]",
          },
        }}
      />
    </LocaleProvider>
  );
}
