"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";

type View = "farmers" | "fields" | "users" | "publications" | "audit";
type Row = { id: string; title: string | null; detail: string; status: string | null; createdAt: string; passportId: string | null };

export function AdminRecords({ onOpenPassport }: { onOpenPassport: (id: string) => void }) {
  const t = useT().review;
  const { locale } = useLocale();
  const [view, setView] = useState<View>("farmers");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const tabs: [View, string][] = [["farmers", t.farmers], ["fields", t.fields], ["users", t.usersTab], ["publications", t.publications], ["audit", t.auditTab]];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/records?view=${view}&page=${page}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json() as { items: Row[]; total: number };
      setRows(result.items); setTotal(result.total); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [view, page]);
  useEffect(() => { void load(); }, [load, revision]);

  return <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="admin-records-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="admin-records-heading" className="text-lg font-semibold text-ink">{t.records}</h2><button type="button" onClick={() => setRevision((value) => value + 1)} className="text-sm text-brand-700 underline">{t.refresh}</button></div>
    <div role="tablist" aria-label={t.records} className="mt-4 flex flex-wrap gap-2">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => { setView(key); setPage(0); }} className={`rounded-lg px-3 py-2 text-sm ${view === key ? "bg-brand-600 text-white" : "border border-border text-ink"}`}>{label}</button>)}</div>
    <div role="tabpanel" className="mt-4">{loading ? <p role="status" className="text-sm text-ink-muted">{t.loading}</p> : error ? <p role="alert" className="text-sm text-danger">{t.loadError}</p> : !rows.length ? <p className="text-sm text-ink-muted">{t.noRecords}</p> : <ul className="divide-y divide-border">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium text-ink">{row.title || t.untitled}</p><p className="break-all text-ink-muted">{row.detail}</p><p className="text-xs text-ink-muted">{row.status ? `${row.status} · ` : ""}{new Date(row.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</p></div>{row.passportId && <button type="button" onClick={() => onOpenPassport(row.passportId!)} className="text-brand-700 underline">{t.details}</button>}</li>)}</ul>}</div>
    <div className="mt-4 flex justify-between text-sm"><span>{t.resultCount}: {total}</span><div className="flex gap-3"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="text-brand-700 underline disabled:opacity-50">{t.previous}</button><button type="button" disabled={(page + 1) * 20 >= total} onClick={() => setPage((value) => value + 1)} className="text-brand-700 underline disabled:opacity-50">{t.next}</button></div></div>
  </section>;
}
