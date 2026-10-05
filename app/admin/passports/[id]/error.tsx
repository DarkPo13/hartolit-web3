"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function ConfirmedDocumentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT().review.confirmedViews;
  return <main className="mx-auto max-w-2xl px-4 py-16">
    <h1 className="font-serif text-3xl font-semibold text-ink">{t.integrityErrorTitle}</h1>
    <p role="alert" className="mt-4 text-sm text-ink-muted">{t.integrityErrorDescription}</p>
    <div className="mt-6 flex flex-wrap gap-4 text-sm">
      <button type="button" onClick={reset} className="font-medium text-brand-700 underline">{t.retry}</button>
      <Link href="/admin" className="font-medium text-brand-700 underline">{t.backToReview}</Link>
    </div>
  </main>;
}
