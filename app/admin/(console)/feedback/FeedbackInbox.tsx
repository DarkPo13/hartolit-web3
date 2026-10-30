"use client";

import { Star } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { PageHeader } from "../ui";

export function FeedbackInbox({ items }: { items: { id: string; rating: number; comment: string; createdAt: string }[] }) {
  const t = useT().feedback;
  const { locale } = useLocale();
  return <div className="max-w-3xl">
    <PageHeader title={t.inbox} hint={t.inboxHint} />
    {!items.length ? <p className="rounded-2xl border border-border bg-surface p-6 text-ink-muted">{t.empty}</p> : <ol className="space-y-4">{items.map(item => <li key={item.id} className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Star className="h-4 w-4 fill-accent-400 text-accent-500" aria-hidden />{t.rating}: {item.rating}/5</span>
        <time dateTime={item.createdAt} className="text-ink-muted">{new Date(item.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</time>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.comment}</p>
    </li>)}</ol>}
  </div>;
}
