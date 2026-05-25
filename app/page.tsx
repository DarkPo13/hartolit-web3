"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Leaf, BookOpen, FileSearch, Github } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ChainBadge } from "@/components/web3/ChainBadge";
import { ConnectWallet } from "@/components/web3/ConnectWallet";
import { StepsNav } from "@/components/wizard/StepsNav";
import { Step1Form } from "@/components/wizard/Step1Form";
import { useWizardStore } from "@/lib/store";

const Step2Blockchain = dynamic(
  () => import("@/components/wizard/Step2Blockchain").then((m) => m.Step2Blockchain),
  { ssr: false },
);
const Step3Certificate = dynamic(
  () => import("@/components/wizard/Step3Certificate").then((m) => m.Step3Certificate),
  { ssr: false },
);

export default function HomePage() {
  const step = useWizardStore((s) => s.step);

  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pt-10">
        <Hero />
        <div className="mt-8 mb-6">
          <StepsNav />
        </div>
        <div key={step} className="mt-4">
          {step === 1 && <Step1Form />}
          {step === 2 && <Step2Blockchain />}
          {step === 3 && <Step3Certificate />}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-canvas/80 glass">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-soft">
            <Leaf className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight truncate">
              Hartolit Digital Field Passport
            </h1>
            <p className="hidden md:block text-xs text-ink-muted">
              On-chain certificate for every drone treatment
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <ChainBadge />
          </div>
          <ConnectWallet compact />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-brand-50 via-surface to-accent-300/20 p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">ERC-721 · BNB Chain</Badge>
        <Badge tone="accent">Дія КЕП</Badge>
        <Badge tone="info">IPFS · Pinata</Badge>
      </div>
      <h2
        className="mt-4 text-3xl md:text-4xl font-semibold leading-tight tracking-tight"
        style={{ fontFamily: "var(--font-crimson)" }}
      >
        Кожна обробка — як підпис у блокчейні.
      </h2>
      <p className="mt-2 max-w-2xl text-sm md:text-base text-ink-muted">
        Заповніть дані обробки, додайте файли метео та документ закупівлі, отримайте два КЕП-підписи
        (пілот + постачальник) — і випустіть NFT-сертифікат, який не можна підробити чи стерти.
      </p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-surface-2/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span>© {new Date().getFullYear()} Hartolit · VANTREXIS</span>
          <ChainBadge />
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://hartolit-agro.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <BookOpen className="h-3.5 w-3.5" /> Про проект
          </a>
          <Link href="/verify/1" className="inline-flex items-center gap-1 hover:text-ink">
            <FileSearch className="h-3.5 w-3.5" /> Верифікувати
          </Link>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <Github className="h-3.5 w-3.5" /> GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
