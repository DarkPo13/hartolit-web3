"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { AdminRecords } from "./AdminRecords";

type Person = { id: string; name: string; email: string };
type Item = { id: string; status: string; version: number; submittedAt: string | null; farmer: { legalName: string | null }; field: { crop: string | null }; owner: Person; reviewer: Person | null };
type Overview = { counts: Record<string, number>; activity: { id: string; action: string; createdAt: string }[]; reviewers: Person[] };
type Detail = {
  id: string; status: string; version: number; owner: Person; reviewer: Person | null; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null;
  farmer: Record<string, string | null>; field: Record<string, string | number | null>;
  treatment: Record<string, string | null> | null; meteo: Record<string, string | number | null> | null; chemical: Record<string, string | number | null> | null;
  evidence: { id: string; kind: string; status: string; filename: string }[];
  audit: { id: string; action: string; actorName: string; note: string | null; createdAt: string }[];
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

function Fields({ values }: { values: [string, string | number | null | undefined][] }) {
  return <dl className="mt-3 grid grid-cols-2 gap-3">{values.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="break-words text-sm text-ink">{value}</dd></div>)}</dl>;
}

export function AdminConsole({ actorId }: { actorId: string }) {
  const t = useT().review;
  const { locale, setLocale } = useLocale();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("SUBMITTED");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reviewerId, setReviewerId] = useState("");
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | "CORRECTION_REQUIRED">("APPROVED");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const labels: Record<string, string> = { SUBMITTED: t.submitted, APPROVED: t.approved, REJECTED: t.rejected, CORRECTION_REQUIRED: t.correctionRequired, PUBLISHING: t.publishing, PUBLISHED: t.published, FAILED_RETRYABLE: t.failed };
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US") : "—";

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter, search: query, page: String(page) });
      const [queue, summary] = await Promise.all([getJson<{ items: Item[]; total: number }>(`/api/admin/passports?${params}`), getJson<Overview>("/api/admin/overview")]);
      setItems(queue.items); setTotal(queue.total); setOverview(summary); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [filter, query, page]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const result = await getJson<{ passport: Detail }>(`/api/admin/passports/${encodeURIComponent(id)}`);
      setDetail(result.passport); setReviewerId(result.passport.reviewer?.id ?? ""); setDecision(result.passport.status === "APPROVED" ? "CORRECTION_REQUIRED" : "APPROVED"); setDetailError(false);
    } catch { setDetailError(true); }
    finally { setDetailLoading(false); }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  async function post(path: "assign" | "decision", body: object) {
    if (!detail || busy) return;
    setBusy(true); setActionError("");
    try {
      const response = await fetch(`/api/admin/passports/${detail.id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: detail.version, ...body }) });
      if (!response.ok) {
        if (response.status === 409) { await loadDetail(detail.id); setActionError(t.changed); return; }
        const payload = await response.json(); setActionError(typeof payload.error === "string" ? payload.error : t.actionError); return;
      }
      await Promise.all([loadDetail(detail.id), loadQueue()]); setNote("");
    } catch { setActionError(t.actionError); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:py-12">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-ink">{t.adminTitle}</h1><p className="mt-2 text-sm text-ink-muted">{t.adminHint}</p></div><div className="flex items-center gap-4"><button type="button" onClick={() => setLocale(locale === "uk" ? "en" : "uk")} aria-label={locale === "uk" ? "Switch to English" : "Перейти на українську"} className="text-sm font-medium text-brand-700 underline">{locale === "uk" ? "EN" : "УКР"}</button><Link href="/" className="text-sm font-medium text-brand-700 underline">{t.operator}</Link></div></header>
    <p className="rounded-xl border border-border bg-surface p-3 text-sm text-ink-muted">{t.publicationDisabled}</p>
    {selectedId ? <>
      <button type="button" onClick={() => { setSelectedId(null); setDetail(null); setActionError(""); }} className="text-sm font-medium text-brand-700 underline">{t.backToQueue}</button>
      {detailLoading && <p role="status">{t.loading}</p>}
      {detailError && <p role="alert" className="text-sm text-danger">{t.detailsError} <button type="button" onClick={() => void loadDetail(selectedId)} className="underline">{t.refresh}</button></p>}
      {detail && <div className="space-y-5">
        <section className="rounded-2xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold text-ink">{detail.farmer.legalName || t.untitled}</h2><p className="mt-2 text-sm text-ink-muted">{labels[detail.status] ?? detail.status} · {detail.field.crop || "—"}</p><Fields values={[[t.owner, `${detail.owner.name} (${detail.owner.email})`], [t.reviewer, detail.reviewer?.name ?? t.unassigned], [t.submittedAt, date(detail.submittedAt)], [t.reviewedAt, date(detail.reviewedAt)]]} />{detail.reviewNote && <p className="mt-4 whitespace-pre-wrap text-sm">{t.note}: {detail.reviewNote}</p>}</section>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.farmerField}</h3><Fields values={[[t.name, detail.farmer.legalName], [t.registration, detail.farmer.registrationId], [t.crop, detail.field.crop], [t.area, detail.field.areaHectares], [t.gps, detail.field.gpsCoords], [t.cadastral, detail.field.cadastralNumber], [t.owner, detail.farmer.contactName], ["Email", detail.farmer.contactEmail], ["Phone", detail.farmer.contactPhone]]} /></section>
          <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.treatment}</h3><Fields values={[[t.type, detail.treatment?.treatmentType], [t.date, detail.treatment?.treatmentDate], [t.time, detail.treatment?.treatmentTime], [t.drone, detail.treatment?.droneModel], [t.operator, detail.treatment?.operator], [t.pilotCert, detail.treatment?.pilotCert], [t.note, detail.treatment?.notes]]} /></section>
          <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.meteo}</h3><Fields values={[[t.temperature, detail.meteo?.temperatureCelsius], [t.humidity, detail.meteo?.humidityPercent], [t.wind, detail.meteo?.windSpeedMps], [t.rainfall, detail.meteo?.rainfallMm]]} /></section>
          <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.chemical}</h3><Fields values={[[t.product, detail.chemical?.product], [t.activeSubstance, detail.chemical?.activeSubstance], [t.dose, detail.chemical?.dosePerHa], [t.volume, detail.chemical?.workingVolume], [t.manufacturer, detail.chemical?.manufacturer], [t.registration, detail.chemical?.registrationNo], [t.supplier, detail.chemical?.supplierName]]} /></section>
        </div>
        <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.evidence}</h3>{!detail.evidence.length ? <p className="mt-3 text-sm text-ink-muted">{t.noEvidence}</p> : <ul className="mt-3 divide-y divide-border">{detail.evidence.map((file) => <li key={file.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="break-all">{file.filename} · {file.kind} · {file.status}</span>{file.status === "READY" && <a href={`/api/admin/passports/${detail.id}/evidence/${file.id}/preview`} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{t.download}</a>}</li>)}</ul>}</section>
        {(detail.status === "SUBMITTED" || detail.status === "APPROVED") && <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.decision}</h3>
          {detail.status === "SUBMITTED" && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 text-sm">{t.assign}<select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">{t.unassigned}</option>{overview?.reviewers.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label><button type="button" onClick={() => void post("assign", { reviewerId: reviewerId || null })} disabled={busy || reviewerId === (detail.reviewer?.id ?? "")} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{t.assign}</button>{detail.reviewer?.id !== actorId && <button type="button" onClick={() => void post("assign", { reviewerId: actorId })} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{t.claim}</button>}</div>}
          {detail.reviewer?.id === actorId && <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (decision !== "APPROVED" && !note.trim()) { setActionError(t.reasonRequired); return; } void post("decision", { decision, note: note.trim() }); }}><fieldset disabled={busy}><legend className="text-sm">{t.decision}</legend><div className="mt-2 flex flex-wrap gap-4 text-sm">{(detail.status === "SUBMITTED" ? [["APPROVED", t.approve], ["REJECTED", t.reject], ["CORRECTION_REQUIRED", t.requestCorrection]] : [["CORRECTION_REQUIRED", t.requestCorrection]]).map(([value, label]) => <label key={value} className="flex items-center gap-1"><input type="radio" name="decision" checked={decision === value} onChange={() => setDecision(value as typeof decision)} />{label}</label>)}</div></fieldset><label className="block text-sm">{t.note}<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} disabled={busy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label><button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{t.saveDecision}</button></form>}
          {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}
        </section>}
        <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">{t.audit}</h3>{!detail.audit.length ? <p className="mt-3 text-sm text-ink-muted">{t.noAudit}</p> : <ol className="mt-3 divide-y divide-border">{detail.audit.map((event) => <li key={event.id} className="py-2 text-sm"><span className="font-medium">{event.action.replaceAll("_", " ")}</span> · {event.actorName} · {date(event.createdAt)}{event.note && <p className="whitespace-pre-wrap text-ink-muted">{event.note}</p>}</li>)}</ol>}</section>
      </div>}
    </> : <>
      <section><h2 className="text-lg font-semibold">{t.dashboard}</h2><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{["SUBMITTED", "APPROVED", "CORRECTION_REQUIRED", "REJECTED"].map((status) => <div key={status} className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-ink-muted">{labels[status]}</p><p className="mt-1 text-2xl font-semibold">{overview?.counts[status] ?? 0}</p></div>)}</div></section>
      <section className="rounded-2xl border border-border bg-surface p-5"><div className="flex justify-between gap-2"><h2 className="text-lg font-semibold">{t.queue}</h2><button type="button" onClick={() => void loadQueue()} className="text-sm text-brand-700 underline">{t.refresh}</button></div>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setPage(0); setQuery(search.trim()); }}><label className="min-w-48 flex-1 text-sm">{t.search}<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder={t.searchPlaceholder} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label><label className="text-sm">{t.filter}<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="ALL">{t.all}</option>{["SUBMITTED", "APPROVED", "CORRECTION_REQUIRED", "REJECTED"].map((status) => <option key={status} value={status}>{labels[status]}</option>)}</select></label><button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">{t.search}</button></form>
        {loading ? <p role="status" className="mt-4 text-sm">{t.loading}</p> : error ? <p role="alert" className="mt-4 text-sm text-danger">{t.loadError}</p> : !items.length ? <p className="mt-4 text-sm text-ink-muted">{t.emptyQueue}</p> : <ul className="mt-4 divide-y divide-border">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.farmer.legalName || t.untitled} · {item.field.crop || "—"}</p><p className="text-ink-muted">{labels[item.status] ?? item.status} · {item.owner.email} · {date(item.submittedAt)}</p></div><button type="button" onClick={() => setSelectedId(item.id)} className="text-brand-700 underline">{t.details}</button></li>)}</ul>}
        <div className="mt-4 flex justify-between text-sm"><span>{t.resultCount}: {total}</span><div className="flex gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="text-brand-700 underline disabled:opacity-50">{t.previous}</button><button type="button" disabled={(page + 1) * 20 >= total} onClick={() => setPage(page + 1)} className="text-brand-700 underline disabled:opacity-50">{t.next}</button></div></div>
      </section>
      <AdminRecords onOpenPassport={setSelectedId} />
    </>}
  </main>;
}
