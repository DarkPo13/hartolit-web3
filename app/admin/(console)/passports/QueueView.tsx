"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { getJson, useAdminOverview, type QueueItem } from "../admin-data";
import { QueueList } from "../QueueList";
import { PageHeader, Panel, buttonClass } from "../ui";

const statuses = ["SUBMITTED", "APPROVED", "CORRECTION_REQUIRED", "REJECTED", "ISSUED", "ALL"] as const;
type Status = typeof statuses[number];

/** Filter, search and page live in the URL, so a record opened from here comes
 * back to the same list with the browser's Back button.
 */
export function QueueView({ actorId }: { actorId: string }) {
  const t = useT();
  const r = t.review, s = t.adminShell;
  const params = useSearchParams();
  const status: Status = statuses.find(value => value === params.get("status")) ?? "SUBMITTED";
  const query = params.get("q") ?? "";
  const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
  const { overview, refresh } = useAdminOverview();
  const [search, setSearch] = useState(query);
  const [result, setResult] = useState<{ items: QueueItem[]; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => setSearch(query), [query]);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(false);
    void getJson<{ items: QueueItem[]; total: number }>(`/api/admin/passports?${new URLSearchParams({ status, search: query, page: String(page) })}`, controller.signal)
      .then(setResult)
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [status, query, page, revision]);

  function go(next: { status?: Status; q?: string; page?: number }) {
    const values = { status, q: query, page, ...next };
    const url = new URLSearchParams({ status: values.status });
    if (values.q) url.set("q", values.q);
    if (values.page) url.set("page", String(values.page));
    window.history.pushState(null, "", `/admin/passports?${url}`);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); go({ q: search.trim(), page: 0 }); }
  const label = (value: Status) => value === "ISSUED" ? r.issuedFilter : value === "ALL" ? r.all : t.codes.passportStatus[value];
  const pages = result ? Math.max(1, Math.ceil(result.total / 20)) : 1;

  return <>
    <PageHeader title={s.items.queue} hint={s.queueHint} actions={<button type="button" onClick={() => { setRevision(value => value + 1); refresh(); }} className={buttonClass.secondary}>{r.refresh}</button>} />
    <div role="group" aria-label={s.statusFilter} className="-mx-1 mb-4 flex flex-wrap gap-1.5">
      {statuses.map(value => {
        const count = value === "ISSUED" || value === "ALL" ? undefined : overview?.counts[value];
        return <button key={value} type="button" aria-pressed={status === value} onClick={() => go({ status: value, page: 0 })}
          className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", status === value ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-surface text-ink-muted hover:text-ink")}>
          {label(value)}
          {count !== undefined && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", status === value ? "bg-white/20" : "bg-surface-2")}>{count}</span>}
        </button>;
      })}
    </div>
    <Panel flush>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3 border-b border-border p-4 sm:px-5">
        <label className="min-w-52 flex-1 text-sm font-medium text-ink">{r.search}
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder={r.searchPlaceholder} className="block w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 font-normal" />
          </span>
        </label>
        <button type="submit" className={buttonClass.primary}>{r.search}</button>
      </form>
      {error ? <p role="alert" className="p-5 text-sm text-danger">{r.loadError}</p>
        : !result ? <p role="status" className="p-5 text-sm text-ink-muted">{r.loading}</p>
          : !result.items.length ? <p className="p-5 text-sm text-ink-muted">{r.emptyQueue}</p>
            : <QueueList items={result.items} actorId={actorId} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:px-5">
        <span className="text-ink-muted">{r.resultCount}: {result?.total ?? "…"} · {page + 1} / {pages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page === 0} onClick={() => go({ page: page - 1 })} className={buttonClass.secondary}>{r.previous}</button>
          <button type="button" disabled={!result || (page + 1) * 20 >= result.total} onClick={() => go({ page: page + 1 })} className={buttonClass.secondary}>{r.next}</button>
        </div>
      </div>
    </Panel>
  </>;
}
