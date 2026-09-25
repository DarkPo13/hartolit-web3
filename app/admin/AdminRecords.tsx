"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { RecordEditor } from "./RecordEditor";

type View = "farmers" | "fields" | "users" | "publications" | "audit" | "adminActions";
type Row = { id: string; title: string | null; detail: string; status: string | null; role: string | null; createdAt: string; passportId: string | null };

export function AdminRecords({ onOpenPassport }: { onOpenPassport: (id: string) => void }) {
  const t = useT();
  const r = t.review, m = t.management;
  const { locale } = useLocale();
  const [view, setView] = useState<View>("farmers");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateQuery, setDateQuery] = useState({ from: "", to: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"" | "load" | "invite" | "action">("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const tabs: [View, string][] = [["farmers", r.farmers], ["fields", r.fields], ["users", r.usersTab], ["publications", r.publications], ["audit", r.auditTab], ["adminActions", m.actions]];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ view, page: String(page), search: query, from: dateQuery.from, to: dateQuery.to });
    void fetch(`/api/admin/records?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ items: Row[]; total: number }>; })
      .then((result) => { setRows(result.items); setTotal(result.total); })
      .catch(() => { if (!controller.signal.aborted) { setRows([]); setTotal(0); setError("load"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, page, query, dateQuery, revision]);

  function changeView(next: View) { setView(next); setPage(0); setSearch(""); setQuery(""); setFromDate(""); setToDate(""); setDateQuery({ from: "", to: "" }); setSelectedId(null); setNotice(""); setError(""); }
  function submitSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(0); setQuery(search.trim()); setDateQuery({ from: fromDate, to: toDate }); setSelectedId(null); }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId("invite"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim() }) });
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json() as { user: { emailRequested: boolean } };
      setInviteName(""); setInviteEmail(""); setNotice(result.user.emailRequested ? m.invited : m.inviteFallback); setRevision((value) => value + 1);
    } catch { setError("invite"); }
    finally { setBusyId(null); }
  }

  async function userAction(row: Row, action: "disable" | "enable" | "revokeSessions") {
    if (action === "disable" && !window.confirm(m.confirmDisable)) return;
    if (action === "revokeSessions" && !window.confirm(m.confirmRevoke)) return;
    setBusyId(row.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(row.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error(String(response.status));
      setNotice(m.userUpdated); setRevision((value) => value + 1);
    } catch { setError("action"); }
    finally { setBusyId(null); }
  }

  return <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="admin-records-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="admin-records-heading" className="text-lg font-semibold text-ink">{r.records}</h2><button type="button" onClick={() => setRevision((value) => value + 1)} className="text-sm text-brand-700 underline">{r.refresh}</button></div>
    <div aria-label={r.records} className="mt-4 flex flex-wrap gap-2">{tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => changeView(key)} className={`rounded-lg px-3 py-2 text-sm ${view === key ? "bg-brand-600 text-white" : "border border-border text-ink"}`}>{label}</button>)}</div>
    {view === "users" && <form onSubmit={invite} className="mt-5 rounded-xl border border-border p-4"><h3 className="font-semibold">{m.inviteTitle}</h3><p className="mt-1 text-sm text-ink-muted">{m.inviteHint}</p><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-sm">{m.inviteName}<input required maxLength={200} value={inviteName} onChange={(event) => setInviteName(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label><label className="min-w-52 flex-1 text-sm">{m.inviteEmail}<input required type="email" maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label><button type="submit" disabled={busyId !== null} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{m.invite}</button></div><p className="mt-2 text-xs text-ink-muted">{m.resetHint}</p></form>}
    <form onSubmit={submitSearch} className="mt-5 flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-sm">{r.search}<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder={m.searchHint} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label>{(view === "audit" || view === "adminActions") && <><label className="text-sm">{m.fromDate}<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label><label className="text-sm">{m.toDate}<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label></>}<button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm">{m.searchButton}</button></form>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error === "load" ? r.loadError : error === "invite" ? m.inviteError : m.actionError}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-brand-700">{notice}</p>}
    <div className="mt-4">{loading ? <p role="status" className="text-sm text-ink-muted">{r.loading}</p> : error === "load" ? null : !rows.length ? <p className="text-sm text-ink-muted">{r.noRecords}</p> : <ul className="divide-y divide-border">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium text-ink">{row.title || r.untitled}</p><p className="break-all text-ink-muted">{row.detail}</p><p className="text-xs text-ink-muted">{row.status ? `${row.status} · ` : ""}{new Date(row.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</p></div><div className="flex flex-wrap gap-3">{(view === "farmers" || view === "fields") && <button type="button" onClick={() => setSelectedId(row.id)} className="text-brand-700 underline">{m.open}</button>}{row.passportId && <button type="button" onClick={() => onOpenPassport(row.passportId!)} className="text-brand-700 underline">{r.details}</button>}{view === "users" && row.role !== "admin" && <><button type="button" disabled={busyId !== null} onClick={() => void userAction(row, row.status === "BANNED" ? "enable" : "disable")} className="text-brand-700 underline disabled:opacity-50">{row.status === "BANNED" ? m.enable : m.disable}</button><button type="button" disabled={busyId !== null} onClick={() => void userAction(row, "revokeSessions")} className="text-brand-700 underline disabled:opacity-50">{m.revokeSessions}</button></>}{view === "users" && row.role === "admin" && <span className="text-xs text-ink-muted">{m.adminUserProtected}</span>}</div></li>)}</ul>}</div>
    <div className="mt-4 flex justify-between text-sm"><span>{r.resultCount}: {total}</span><div className="flex gap-3"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="text-brand-700 underline disabled:opacity-50">{r.previous}</button><button type="button" disabled={(page + 1) * 20 >= total} onClick={() => setPage((value) => value + 1)} className="text-brand-700 underline disabled:opacity-50">{r.next}</button></div></div>
    {selectedId && (view === "farmers" || view === "fields") && <RecordEditor kind={view} id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => setRevision((value) => value + 1)} onOpenPassport={onOpenPassport} />}
  </section>;
}
