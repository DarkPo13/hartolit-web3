"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function ConfirmedDocumentNotFound() {
  const t = useT().review.confirmedViews;
  return <main className="mx-auto max-w-2xl px-4 py-16">
    <h1 className="font-serif text-3xl font-semibold text-ink">{t.unavailableTitle}</h1>
    <p className="mt-4 text-sm text-ink-muted">{t.unavailableDescription}</p>
    <Link href="/admin" className="mt-6 inline-block text-sm font-medium text-brand-700 underline">{t.backToReview}</Link>
  </main>;
}
