"use client";

import Link from "next/link";
import { PublicSnapshotView, type PublicConfirmation } from "./PublicSnapshotView";
import { useLocale, useT } from "@/lib/i18n/context";

export function ConfirmedSnapshotDocument({ kind, confirmation, passportId }: {
  kind: "certificate" | "verification";
  confirmation: PublicConfirmation;
  passportId: string;
}) {
  const { locale, setLocale } = useLocale();
  const t = useT().review.confirmedViews;
  const certificate = kind === "certificate";

  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:py-12">
    <nav aria-label={t.navigation} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <Link href="/admin" className="font-medium text-brand-700 underline">{t.backToReview}</Link>
      <button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} className="font-medium text-brand-700 underline" aria-label={locale === "uk" ? "Switch to English" : "Перейти на українську"}>{locale === "uk" ? "EN" : "УКР"}</button>
    </nav>
    <header className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <p className="inline-block rounded-full border border-accent-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-700">{t.unpublished}</p>
      <h1 className="mt-4 font-serif text-3xl font-semibold text-ink sm:text-4xl">{certificate ? t.certificateTitle : t.verificationTitle}</h1>
      <p className="mt-3 text-sm text-ink-muted">{certificate ? t.certificateDescription : t.verificationDescription}</p>
      <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-muted">{t.confirmedAt}</dt><dd className="mt-1 font-medium">{new Date(confirmation.confirmedAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</dd></div>
        <div><dt className="text-ink-muted">{t.savedIntegrity}</dt><dd className="mt-1 font-medium">{t.hashMatches}</dd></div>
      </dl>
      <p className="mt-5 rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">{t.limits}</p>
      <Link href={`/admin/passports/${encodeURIComponent(passportId)}/${certificate ? "verification" : "certificate"}`} className="mt-5 inline-block text-sm font-medium text-brand-700 underline">{certificate ? t.openVerification : t.openCertificate}</Link>
    </header>
    <PublicSnapshotView preview={confirmation.preview} confirmed />
  </main>;
}
