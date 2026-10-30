"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { RecordEditor } from "./RecordEditor";
import { Drawer, PageHeader, Panel, buttonClass } from "./(console)/ui";

type View = "farmers" | "fields" | "users" | "publications" | "audit" | "adminActions";
type Facts = { fields?: number; passports?: number; crop?: string | null; mfa?: boolean };
type Row = { id: string; title: string | null; code?: string; detail: string; facts?: Facts; status: string | null; role: string | null; createdAt: string; passportId: string | null };

/** One registry or log, on its own admin page. */
export function AdminRecords({ view }: { view: View }) {
  const t = useT();
  const router = useRouter();
  const onOpenPassport = (id: string) => router.push(`/admin/passports/${encodeURIComponent(id)}`);
  const r = t.review, m = t.management;
  const { locale } = useLocale();
  const c = t.codes;
  const title = (row: Row) => row.code ? c.audit[row.code] ?? c.adminActions[row.code] ?? row.title : row.title;
  const detail = (row: Row) => [row.detail, row.facts?.crop ? t.crops[row.facts.crop as keyof typeof t.crops] ?? row.facts.crop : null,
    row.facts?.mfa === undefined ? null : row.role === "admin" ? c.roleAdmin : c.roleUser, row.facts?.mfa === undefined ? null : row.facts.mfa ? c.mfaOn : c.mfaOff,
    row.facts?.fields === undefined ? null : `${c.fields}: ${row.facts.fields}`, row.facts?.passports === undefined ? null : `${c.passports}: ${row.facts.passports}`]
    .filter(Boolean).join(" · ");
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

  const s = t.adminShell;
  const field = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 font-normal";
  return <>
    <PageHeader title={s.items[view]} hint={s.hints[view]} actions={<button type="button" onClick={() => setRevision((value) => value + 1)} className={buttonClass.secondary}>{r.refresh}</button>} />
    {view === "users" && <Panel title={m.inviteTitle} className="mb-6"><form onSubmit={invite}><p className="text-sm text-ink-muted">{m.inviteHint}</p><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-sm font-medium">{m.inviteName}<input required maxLength={200} value={inviteName} onChange={(event) => setInviteName(event.target.value)} className={field} /></label><label className="min-w-52 flex-1 text-sm font-medium">{m.inviteEmail}<input required type="email" maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className={field} /></label><button type="submit" disabled={busyId !== null} className={buttonClass.primary}>{m.invite}</button></div><p className="mt-2 text-xs text-ink-muted">{m.resetHint}</p></form></Panel>}
    <Panel flush>
      <form onSubmit={submitSearch} role="search" className="flex flex-wrap items-end gap-3 border-b border-border p-4 sm:px-5"><label className="min-w-52 flex-1 text-sm font-medium">{r.search}<span className="relative mt-1 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden /><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder={m.searchHint} className="block w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 font-normal" /></span></label>{(view === "audit" || view === "adminActions") && <><label className="text-sm font-medium">{m.fromDate}<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className={field} /></label><label className="text-sm font-medium">{m.toDate}<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className={field} /></label></>}<button type="submit" className={buttonClass.primary}>{m.searchButton}</button></form>
      {error && <p role="alert" className="px-5 pt-4 text-sm text-danger">{error === "load" ? r.loadError : error === "invite" ? m.inviteError : m.actionError}</p>}
      {notice && <p role="status" className="px-5 pt-4 text-sm text-brand-700">{notice}</p>}
      {loading ? <p role="status" className="p-5 text-sm text-ink-muted">{r.loading}</p> : error === "load" ? null : !rows.length ? <p className="p-5 text-sm text-ink-muted">{r.noRecords}</p> : <ul className="divide-y divide-border">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/70 sm:px-5"><div className="min-w-0"><p className="break-words font-medium text-ink">{title(row) || r.untitled}</p><p className="break-all text-ink-muted">{detail(row)}</p><p className="text-xs text-ink-muted">{row.status ? `${c.recordStatus[row.status] ?? c.publicationStatus[row.status] ?? row.status} · ` : ""}{new Date(row.createdAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</p></div><div className="flex flex-wrap gap-2">{(view === "farmers" || view === "fields") && <button type="button" onClick={() => setSelectedId(row.id)} className={buttonClass.secondary}>{m.open}</button>}{row.passportId && <button type="button" onClick={() => onOpenPassport(row.passportId!)} className={buttonClass.secondary}>{r.details}</button>}{view === "users" && row.role !== "admin" && <><button type="button" disabled={busyId !== null} onClick={() => void userAction(row, row.status === "BANNED" ? "enable" : "disable")} className={buttonClass.secondary}>{row.status === "BANNED" ? m.enable : m.disable}</button><button type="button" disabled={busyId !== null} onClick={() => void userAction(row, "revokeSessions")} className={buttonClass.secondary}>{m.revokeSessions}</button></>}{view === "users" && row.role === "admin" && <span className="text-xs text-ink-muted">{m.adminUserProtected}</span>}</div></li>)}</ul>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:px-5"><span className="text-ink-muted">{r.resultCount}: {total}</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className={buttonClass.secondary}>{r.previous}</button><button type="button" disabled={(page + 1) * 20 >= total} onClick={() => setPage((value) => value + 1)} className={buttonClass.secondary}>{r.next}</button></div></div>
    </Panel>
    {(view === "farmers" || view === "fields") && <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)} labelledBy="record-detail-heading">
      {selectedId && <RecordEditor kind={view} id={selectedId} onChanged={() => setRevision((value) => value + 1)} onOpenPassport={onOpenPassport} />}
    </Drawer>}
  </>;
}
