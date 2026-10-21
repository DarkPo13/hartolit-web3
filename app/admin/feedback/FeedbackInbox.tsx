"use client";

import Link from "next/link";
import { useLocale, useT } from "@/lib/i18n/context";

export function FeedbackInbox({ items }: { items: { id: string; rating: number; comment: string; createdAt: string }[] }) {
  const t = useT().feedback;
  const { locale, setLocale } = useLocale();
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
    <nav className="flex justify-between text-sm" aria-label={t.navigation}>
      <Link href="/admin" className="font-medium text-brand-700 underline">{t.backToAdmin}</Link>
      <button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} className="font-medium text-brand-700 underline">{locale === "uk" ? "EN" : "УКР"}</button>
    </nav>
    <header><h1 className="font-serif text-3xl font-semibold">{t.inbox}</h1><p className="mt-2 text-sm text-ink-muted">{t.inboxHint}</p></header>
    {!items.length ? <p className="rounded-2xl border border-border bg-surface p-6 text-ink-muted">{t.empty}</p> : <ol className="space-y-4">{items.map(item => <li key={item.id} className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{t.rating}: {item.rating}/5</span><time dateTime={item.createdAt} className="text-ink-muted">{new Date(item.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</time></div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.comment}</p>
    </li>)}</ol>}
  </main>;
}
