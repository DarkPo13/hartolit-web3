"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, FileSearch, Github, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ChainBadge } from "@/components/web3/ChainBadge";
import { StepsNav } from "@/components/wizard/StepsNav";
import { Step1Form } from "@/components/wizard/Step1Form";
import { DraftWorkspace } from "@/components/drafts/DraftWorkspace";
import { useWizardStore } from "@/lib/store";
import { useLocale, useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/demo-mode";
import { authClient } from "@/lib/auth-client";
import type { Locale } from "@/lib/i18n/types";

const Step2Blockchain = dynamic(
  () => import("@/components/wizard/Step2Blockchain").then((m) => m.Step2Blockchain),
  { ssr: false },
);
const ConnectWallet = dynamic(() => import("@/components/web3/ConnectWallet").then((module) => module.ConnectWallet), { ssr: false });
const Step3Certificate = dynamic(
  () => import("@/components/wizard/Step3Certificate").then((m) => m.Step3Certificate),
  { ssr: false },
);

export function PassportHome({ actorId, isAdmin }: { actorId: string; isAdmin: boolean }) {
  const step = useWizardStore((s) => s.step);
  const mockVersion = useWizardStore((s) => s.mockVersion);
  const fillMockData = useWizardStore((s) => s.fillMockData);
  const demoMode = isDemoMode();
  const t = useT();
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    let active = true;
    try {
      const priorActorId = sessionStorage.getItem("hartolit-draft-owner");
      if (priorActorId !== actorId) {
        useWizardStore.getState().reset();
        sessionStorage.removeItem("hartolit-wizard-session");
        sessionStorage.setItem("hartolit-draft-owner", actorId);
      }
      // Remove drafts created by the earlier localStorage implementation.
      localStorage.removeItem("hartolit-wizard");
    } catch {
      // The wizard still works without browser storage, but refresh recovery is unavailable.
    }
    Promise.resolve(useWizardStore.persist.rehydrate()).finally(() => {
      if (active) setStoreReady(true);
    });
    return () => {
      active = false;
    };
  }, [actorId]);

  return (
    <div className="min-h-dvh">
      <Header isAdmin={isAdmin} />
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 md:pt-10">
        {!storeReady ? (
          <section
            className="rounded-2xl border border-border bg-surface p-6"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm text-ink-muted">{t.hero.restoringDraft}</p>
          </section>
        ) : demoMode ? (
          <>
            <Hero onFillMock={step === 1 ? fillMockData : undefined} />
            <div className="mt-8 mb-6">
              <StepsNav />
            </div>
            <div key={step} className="mt-4">
              {step === 1 && <Step1Form key={mockVersion} />}
              {step === 2 && <Step2Blockchain />}
              {step === 3 && <Step3Certificate />}
            </div>
          </>
        ) : (
          <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-6 md:p-8" aria-labelledby="release-status-title">
            <h2 id="release-status-title" className="text-xl font-semibold text-ink">
              {t.release.title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-ink-muted">{t.release.description}</p>
          </section>
          <DraftWorkspace />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const router = useRouter();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  async function signOut() {
    if (signOutPending) return;
    setSignOutPending(true);
    setSignOutError(false);
    const result = await authClient.signOut().catch(() => null);
    if (!result || result.error) {
      setSignOutError(true);
      setSignOutPending(false);
      return;
    }
    useWizardStore.getState().reset();
    try {
      sessionStorage.removeItem("hartolit-wizard-session");
      sessionStorage.removeItem("hartolit-draft-owner");
    } catch {
      // Browser storage may be unavailable; the server session is already closed.
    }
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-canvas/80 glass">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Image src="/logo.png" alt="Hartolit" width={36} height={36} className="rounded-lg" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight truncate">{t.header.title}</h1>
            <p className="hidden md:block text-xs text-ink-muted">{t.header.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && <Link href="/admin" className="text-xs font-medium text-ink hover:text-brand-700">{t.account.admin}</Link>}
          <LocaleToggle />
          {isDemoMode() && <div className="hidden md:block"><ChainBadge /></div>}
          {isDemoMode() && <ConnectWallet compact />}
          <button type="button" onClick={signOut} disabled={signOutPending} className="text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50">{t.account.signOut}</button>
        </div>
      </div>
      {signOutError && <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-xs text-danger">{t.account.signOutError}</p>}
    </header>
  );
}

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs font-medium">
      {(["uk", "en"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={cn(
            "rounded-md px-2.5 py-1 transition-colors",
            locale === l
              ? "bg-brand-600 text-white shadow-soft"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Hero({ onFillMock }: { onFillMock?: () => void }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-brand-50 via-surface to-accent-300/20 p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">{t.hero.badgeErc}</Badge>
        <Badge tone="info">{t.hero.badgeIpfs}</Badge>
      </div>
      <p className="mt-4 max-w-2xl text-sm md:text-base text-ink-muted">{t.hero.description}</p>
      {onFillMock && (
        <div className="mt-5 flex">
          <button
            onClick={onFillMock}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-400 bg-brand-50/60 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 hover:border-brand-500"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {t.hero.fillMock}
          </button>
        </div>
      )}
    </section>
  );
}

function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-border bg-surface-2/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span>© {new Date().getFullYear()} Hartolit · VANTREXIS</span>
          {isDemoMode() && <ChainBadge />}
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://hartolit-agro.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <BookOpen className="h-3.5 w-3.5" /> {t.footer.about}
          </a>
          <Link href="/verify/1" className="inline-flex items-center gap-1 hover:text-ink">
            <FileSearch className="h-3.5 w-3.5" /> {t.footer.verify}
          </Link>
          <a
            href="https://github.com/DarkPo13/hartolit-web3"
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
