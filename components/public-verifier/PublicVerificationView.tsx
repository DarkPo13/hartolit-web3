"use client";

import Link from "next/link";
import { PublicSnapshotView } from "@/components/public-snapshot/PublicSnapshotView";
import { useLocale, useT } from "@/lib/i18n/context";
import type { PublicVerification } from "@/lib/public-verifier/verify";
import type { PublicShare } from "@/lib/public-verifier/share";
import type { IssuerRecordNotice } from "@/lib/public-verifier/issuer-record";
import { PublicShareActions } from "./PublicShareActions";

export type PublicVerificationResult = Exclude<PublicVerification, { status: "INVALID_REQUEST" } | { status: "NOT_FOUND" }>;

const tone = {
  VALID: "border-brand-600 text-brand-700", PENDING: "border-accent-600 text-accent-700", UNAVAILABLE: "border-border text-ink-muted",
  MISMATCH: "border-red-600 text-red-700", UNSUPPORTED: "border-border text-ink-muted",
} as const;

/** Public, sign-in-free rendering of an independent verification result. */
export function PublicVerificationView({ result, share = null, issuer = null }: { result: PublicVerificationResult; share?: PublicShare | null; issuer?: IssuerRecordNotice | null }) {
  const { locale, setLocale } = useLocale();
  const t = useT().publicVerifier;
  const copy = {
    VALID: [t.validBadge, t.validTitle, t.validDescription], PENDING: [t.pendingBadge, t.pendingTitle, t.pendingDescription],
    UNAVAILABLE: [t.unavailableBadge, t.unavailableTitle, result.status === "UNAVAILABLE" && result.reason === "NOT_CONFIGURED" ? t.notConfigured : t.unavailableDescription],
    MISMATCH: [t.mismatchBadge, t.mismatchTitle, t.mismatchDescription], UNSUPPORTED: [t.unsupportedBadge, t.unsupportedTitle, t.unsupportedDescription],
  }[result.status];
  const mismatch = result.status === "MISMATCH"
    ? ({ CHAIN_STATE: t.mismatchChainState, URI: t.mismatchUri, BYTES: t.mismatchBytes } as Record<string, string>)[result.reason] : null;
  const href = `/passports/${encodeURIComponent(result.tokenId)}`;

  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:py-12">
    <nav aria-label={t.navigation} className="flex flex-wrap items-center justify-between gap-3 text-sm print:hidden">
      <span className="font-semibold text-ink">{t.home}</span>
      <button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} className="font-medium text-brand-700 underline"
        aria-label={locale === "uk" ? "Switch to English" : "Перейти на українську"}>{locale === "uk" ? "EN" : "УКР"}</button>
    </nav>
    <header className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <p className="text-sm text-ink-muted">{t.title} · {t.token} #{result.tokenId}</p>
      <p role="status" className={`mt-4 inline-block rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${tone[result.status]}`}>{copy[0]}</p>
      <h1 className="mt-4 font-serif text-3xl font-semibold text-ink sm:text-4xl">{copy[1]}</h1>
      <p className="mt-3 text-sm text-ink-muted">{copy[2]}</p>
      {mismatch && <p className="mt-2 text-sm font-medium text-red-700">{mismatch}</p>}
      <p className="mt-3 text-sm text-ink-muted">{t.subtitle}</p>
      <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">{t.testnet}</p>
      {result.status === "VALID" && issuer && <div role={issuer === "MATCH" || issuer === "UNAVAILABLE" ? undefined : "alert"}
        className={`mt-3 rounded-lg border p-3 text-sm ${issuer === "MATCH" || issuer === "UNAVAILABLE" ? "border-border text-ink-muted" : "border-red-600 font-medium text-red-700"}`}>
        <p className="font-semibold">{t.issuerTitle}</p>
        <p className="mt-1">{{ MATCH: t.issuerMatch, SUSPENDED: t.issuerSuspended, DISAGREES: t.issuerDisagrees, NO_RECORD: t.issuerNoRecord, UNAVAILABLE: t.issuerUnavailable }[issuer]}</p>
      </div>}
      {result.status === "VALID" && <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
        {([[t.token, result.tokenId], [t.contract, result.contractAddress], [t.owner, result.owner], [t.cid, result.cid],
          [t.payloadHash, result.payloadHash], [t.checkedBlock, `${result.checkedBlockNumber} · ${result.checkedBlockHash}`],
          [t.confirmations, `≥ ${result.confirmations}`]] as const).map(([label, value]) =>
          <div key={label} className="min-w-0"><dt className="text-ink-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
      </dl>}
      <p className="mt-5 text-sm text-ink-muted">{t.limits}</p>
      {result.status !== "VALID" && <Link href={href} prefetch={false} className="mt-5 inline-block text-sm font-medium text-brand-700 underline print:hidden">{t.checkAgain}</Link>}
    </header>
    {result.status === "VALID" && share && <PublicShareActions tokenId={result.tokenId} url={share.url} qrDataUrl={share.qrDataUrl} canonicalJson={result.canonicalJson} />}
    {result.status === "VALID" && <section aria-label={t.factsTitle}>
      <h2 className="font-serif text-2xl font-semibold text-ink">{t.factsTitle}</h2>
      <PublicSnapshotView preview={{ snapshot: result.snapshot, canonicalJson: result.canonicalJson, sha256: result.payloadHash }} note={t.publishedRecord} />
    </section>}
  </main>;
}
