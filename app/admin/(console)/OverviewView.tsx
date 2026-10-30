"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock, UserPlus, XCircle } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { formatDate, getJson, useAdminOverview, type QueueItem } from "./admin-data";
import { QueueList } from "./QueueList";
import { PageHeader, Panel, buttonClass } from "./ui";

const tiles = [
  { status: "SUBMITTED", icon: Clock, tone: "border-sky-200 bg-sky-50 text-sky-900" },
  { status: "APPROVED", icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  { status: "CORRECTION_REQUIRED", icon: AlertTriangle, tone: "border-amber-200 bg-amber-50 text-amber-900" },
  { status: "REJECTED", icon: XCircle, tone: "border-rose-200 bg-rose-50 text-rose-900" },
] as const;

export function OverviewView({ actorId }: { actorId: string }) {
  const t = useT();
  const s = t.adminShell;
  const { locale } = useLocale();
  const { overview, failed, refresh } = useAdminOverview();
  const [waiting, setWaiting] = useState<{ items: QueueItem[]; total: number } | null>(null);
  const [waitingFailed, setWaitingFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getJson<{ items: QueueItem[]; total: number }>("/api/admin/passports?status=SUBMITTED&page=0&search=", controller.signal)
      .then(result => { setWaiting(result); setWaitingFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setWaitingFailed(true); });
    return () => controller.abort();
  }, [overview]);

  return <>
    <PageHeader title={s.items.overview} hint={s.overviewHint} actions={<button type="button" onClick={refresh} className={buttonClass.secondary}>{t.review.refresh}</button>} />
    {failed && <p role="alert" className="mb-4 text-sm text-danger">{t.review.loadError}</p>}

    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(({ status, icon: Icon, tone }) => <li key={status}>
        <Link href={`/admin/passports?status=${status}`} className={`flex h-full flex-col justify-between gap-3 rounded-2xl border p-4 transition-shadow hover:shadow-lifted ${tone}`}>
          <span className="flex items-center justify-between gap-2 text-sm font-medium"><span>{t.codes.passportStatus[status]}</span><Icon className="h-5 w-5 shrink-0 opacity-70" aria-hidden /></span>
          <span className="text-3xl font-semibold tabular-nums">{overview ? overview.counts[status] ?? 0 : "…"}</span>
        </Link>
      </li>)}
    </ul>

    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Panel flush className="lg:self-start" title={s.waiting}
        action={<Link href="/admin/passports?status=SUBMITTED" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">{s.allQueue}{waiting ? ` (${waiting.total})` : ""}<ArrowRight className="h-4 w-4" aria-hidden /></Link>}>
        {waitingFailed ? <p role="alert" className="px-5 pb-5 text-sm text-danger">{t.review.loadError}</p>
          : !waiting ? <p role="status" className="px-5 pb-5 text-sm text-ink-muted">{t.review.loading}</p>
            : !waiting.items.length ? <p className="px-5 pb-5 text-sm text-ink-muted">{s.waitingEmpty}</p>
              : <QueueList items={waiting.items.slice(0, 5)} actorId={actorId} />}
      </Panel>

      <div className="space-y-6">
        <Panel title={t.review.activity}>
          {!overview ? <p role="status" className="text-sm text-ink-muted">{t.review.loading}</p>
            : !overview.activity.length ? <p className="text-sm text-ink-muted">{s.activityEmpty}</p>
              : <ol className="space-y-3">{overview.activity.map(event => <li key={event.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                <div className="min-w-0">
                  <p className="text-ink">{event.passportId ? <Link href={`/admin/passports/${encodeURIComponent(event.passportId)}`} className="hover:text-brand-800 hover:underline">{t.codes.audit[event.action] ?? event.action}</Link> : t.codes.audit[event.action] ?? event.action}</p>
                  <p className="text-xs text-ink-muted"><time dateTime={event.createdAt}>{formatDate(event.createdAt, locale)}</time></p>
                </div>
              </li>)}</ol>}
        </Panel>
        <Panel title={s.quick}>
          <div className="flex flex-col gap-2">
            <Link href="/admin/users" className={`${buttonClass.secondary} justify-start`}><UserPlus className="h-4 w-4 text-brand-700" aria-hidden />{s.inviteOperator}</Link>
            <Link href="/admin/help" className={`${buttonClass.secondary} justify-start`}><BookOpen className="h-4 w-4 text-brand-700" aria-hidden />{s.readGuide}</Link>
          </div>
        </Panel>
      </div>
    </div>
  </>;
}
