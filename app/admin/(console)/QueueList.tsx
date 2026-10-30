"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PassportMarkList } from "@/components/PassportMarkList";
import { Badge } from "@/components/ui/Badge";
import { useLocale, useT } from "@/lib/i18n/context";
import { formatDate, type QueueItem } from "./admin-data";
import { StatusBadge } from "./ui";

/** Records as rows. The farmer name is the link; it stretches over the row so
 * the whole row opens the record, while the public token link stays clickable.
 * Columns follow the list's own width (container queries), so the same rows fit
 * the narrow overview panel and the full-width queue.
 */
export function QueueList({ items, actorId }: { items: QueueItem[]; actorId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const crop = (value: string | null) => value ? t.crops[value as keyof typeof t.crops] ?? value : "—";
  return <ul className="@container divide-y divide-border">
    {items.map(item => <li key={item.id} className="relative grid items-center gap-x-6 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-2/70 sm:px-5 @lg:grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_auto_auto]">
      <div className="min-w-0">
        <Link href={`/admin/passports/${encodeURIComponent(item.id)}`} className="break-words font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand-800">
          {item.farmer.legalName || t.review.untitled}
        </Link>
        <p className="text-sm text-ink-muted">{crop(item.field.crop)}</p>
        <div className="relative z-10"><PassportMarkList marks={item.marks} /></div>
      </div>
      <div className="min-w-0 text-sm @lg:col-start-1 @3xl:col-start-auto">
        <p className="truncate text-ink" title={item.owner.email}>{item.owner.email}</p>
        <p className="text-ink-muted">{t.review.submittedAt}: {formatDate(item.submittedAt, locale)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 @lg:col-start-2 @lg:row-span-2 @lg:row-start-1 @lg:justify-end @3xl:col-start-auto @3xl:row-span-1 @3xl:row-start-auto">
        <StatusBadge status={item.status} />
        {item.status === "SUBMITTED" && (item.reviewer
          ? <Badge tone={item.reviewer.id === actorId ? "brand" : "neutral"}>{item.reviewer.id === actorId ? t.adminShell.assignedToYou : item.reviewer.name}</Badge>
          : <Badge tone="warning">{t.review.unassigned}</Badge>)}
      </div>
      <ChevronRight className="hidden h-4 w-4 text-ink-subtle @3xl:block" aria-hidden />
    </li>)}
  </ul>;
}
