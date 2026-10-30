"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, Download, FileText, Lock } from "lucide-react";
import { PublicSnapshotView, type PublicConfirmation, type PublicPreview } from "@/components/public-snapshot/PublicSnapshotView";
import { useLocale, useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { EvidenceAccess } from "../../../EvidenceAccess";
import { PreservationHolds } from "../../../PreservationHolds";
import { PublicationPanel } from "../../../PublicationPanel";
import { RevealStep } from "../../../RevealStep";
import { formatDate, getJson, useAdminOverview, type Person } from "../../admin-data";
import { PageHeader, Panel, StatusBadge, buttonClass } from "../../ui";

type Detail = {
  id: string; status: string; version: number; owner: Person; reviewer: Person | null; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null; publicFarmLabel: string | null;
  farmer: Record<string, string | null>; field: Record<string, string | number | null>;
  treatment: Record<string, string | null> | null; meteo: Record<string, string | number | null> | null; chemical: Record<string, string | number | null> | null;
  evidence: { id: string; kind: string; status: string; filename: string }[];
  issued?: boolean;
  audit: { id: string; action: string; actorName: string; note: string | null; createdAt: string }[];
};
type SelectedPreview = { passportId: string; passportVersion: number; weatherFileId: string; chemicalFileId: string; value: PublicPreview };
const tabs = ["data", "evidence", "publication", "history"] as const;
type Tab = typeof tabs[number];

function Fields({ values }: { values: [string, string | number | null | undefined][] }) {
  const shown = values.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{shown.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="break-words text-sm text-ink">{value}</dd></div>)}</dl>;
}

export function PassportDetail({ id, actorId }: { id: string; actorId: string }) {
  const translations = useT();
  const t = translations.review, s = translations.adminShell;
  const crop = (value: string | number | null | undefined) => typeof value === "string" && value ? translations.crops[value as keyof typeof translations.crops] ?? value : value;
  const code = (labels: Record<string, string>, value: string | number | null | undefined) => typeof value === "string" && value ? labels[value] ?? value : value;
  const evidenceLabel: Record<string, string> = { METEO: translations.evidence.meteo, CHEMICAL: translations.evidence.chemical, OTHER: translations.evidence.other,
    PENDING: translations.evidence.pending, SCANNING: translations.evidence.scanning, QUARANTINED: translations.evidence.quarantined, READY: translations.evidence.ready, REJECTED: translations.evidence.rejected };
  const { locale } = useLocale();
  const { overview, refresh: refreshOverview } = useAdminOverview();
  const params = useSearchParams();
  const tab: Tab = tabs.find(value => value === params.get("tab")) ?? "data";
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ data: null, evidence: null, publication: null, history: null });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reviewerId, setReviewerId] = useState("");
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | "CORRECTION_REQUIRED">("APPROVED");
  const [note, setNote] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [weatherFileId, setWeatherFileId] = useState("");
  const [chemicalFileId, setChemicalFileId] = useState("");
  const [publicPreview, setPublicPreview] = useState<SelectedPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [publicConfirmation, setPublicConfirmation] = useState<PublicConfirmation | null>(null);
  const [confirmationLoading, setConfirmationLoading] = useState(true);
  // A key, not translated text: loadDetail must not depend on the locale, or
  // switching language would reset an in-progress review.
  const [confirmationError, setConfirmationError] = useState<"" | "load" | "changed" | "error">("");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const detailRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const shownDetailId = useRef<string | null>(null);
  // The step to bring into view after an action that makes it the next one.
  const [reveal, setReveal] = useState<"preview" | "publication" | null>(null);
  const date = (value: string | null) => formatDate(value, locale);

  function selectTab(next: Tab) {
    const url = new URLSearchParams(window.location.search);
    if (next === "data") url.delete("tab"); else url.set("tab", next);
    const search = url.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  async function loadDetail(passportId: string) {
    const requestId = ++detailRequestId.current;
    previewRequestId.current += 1;
    // Refreshing the passport on screen keeps it until the new data arrives: clearing
    // it would collapse the page and throw the reviewer back to the top.
    const refresh = shownDetailId.current === passportId;
    const resetSteps = () => { setPublicPreview(null); setPreviewError(""); setPreviewBusy(false); setWeatherFileId(""); setChemicalFileId(""); setConfirmationError(""); setConfirmationChecked(false); };
    setDetailLoading(true); setDetailError(false);
    if (!refresh) { shownDetailId.current = null; setDetail(null); resetSteps(); setPublicConfirmation(null); setConfirmationLoading(true); setReveal(null); }
    try {
      const result = await getJson<{ passport: Detail }>(`/api/admin/passports/${encodeURIComponent(passportId)}`);
      if (requestId !== detailRequestId.current) return;
      let confirmation: PublicConfirmation | null = null, confirmationFailed = false;
      try { confirmation = (await getJson<{ confirmation: PublicConfirmation | null }>(`/api/admin/passports/${encodeURIComponent(passportId)}/public-confirmation`)).confirmation; }
      catch { confirmationFailed = true; }
      if (requestId !== detailRequestId.current) return;
      shownDetailId.current = passportId;
      resetSteps();
      setDetail(result.passport); setReviewerId(result.passport.reviewer?.id ?? ""); setDecision(result.passport.status === "APPROVED" ? "CORRECTION_REQUIRED" : "APPROVED"); setDetailError(false);
      setPublicConfirmation(confirmation); if (confirmationFailed) setConfirmationError("load");
    } catch { if (requestId === detailRequestId.current) setDetailError(true); }
    finally { if (requestId === detailRequestId.current) { setDetailLoading(false); setConfirmationLoading(false); } }
  }

  const open = useEffectEvent((passportId: string) => void loadDetail(passportId));
  useEffect(() => { open(id); return () => { detailRequestId.current += 1; previewRequestId.current += 1; }; }, [id]);

  async function post(path: "assign" | "decision", body: object): Promise<boolean> {
    if (!detail || busy || confirmationBusy) return false;
    setBusy(true); setActionError("");
    try {
      const response = await fetch(`/api/admin/passports/${detail.id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: detail.version, ...body }) });
      if (!response.ok) {
        if (response.status === 409) {
          const payload = await response.json().catch(() => null);
          await loadDetail(detail.id);
          setActionError(Array.isArray(payload?.issues) && payload.issues.includes("PUBLICATION_STARTED") ? t.publicationStarted : t.changed); return false;
        }
        const payload = await response.json(); setActionError(typeof payload.error === "string" ? payload.error : t.actionError); return false;
      }
      await loadDetail(detail.id); refreshOverview(); setNote("");
      return true;
    } catch { setActionError(t.actionError); return false; }
    finally { setBusy(false); }
  }

  async function loadPublicPreview() {
    if (!detail || !weatherFileId || !chemicalFileId || previewBusy) return;
    const requestId = ++previewRequestId.current;
    const selection = { passportId: detail.id, passportVersion: detail.version, weatherFileId, chemicalFileId };
    setPreviewBusy(true); setPreviewError(""); setPublicPreview(null); setConfirmationChecked(false);
    try {
      const query = new URLSearchParams({ weatherFileId, chemicalFileId });
      const response = await fetch(`/api/admin/passports/${encodeURIComponent(detail.id)}/public-preview?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (requestId !== previewRequestId.current) return;
      if (!response.ok) { setPreviewError([result.error, ...(Array.isArray(result.issues) ? result.issues : [])].filter(Boolean).join(": ") || t.publicPreview.loadError); return; }
      setPublicPreview({ ...selection, value: result.preview as PublicPreview });
    } catch { if (requestId === previewRequestId.current) setPreviewError(t.publicPreview.loadError); }
    finally { if (requestId === previewRequestId.current) setPreviewBusy(false); }
  }

  async function confirmPreview() {
    if (!detail || !publicPreview || !confirmationChecked || confirmationBusy || confirmationLoading || confirmationError || publicConfirmation) return;
    const selection = publicPreview;
    if (selection.passportId !== detail.id || selection.passportVersion !== detail.version || selection.weatherFileId !== weatherFileId || selection.chemicalFileId !== chemicalFileId) return;
    setConfirmationBusy(true); setConfirmationError("");
    try {
      const response = await fetch(`/api/admin/passports/${encodeURIComponent(detail.id)}/public-confirmation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passportVersion: selection.passportVersion, weatherFileId: selection.weatherFileId, chemicalFileId: selection.chemicalFileId, certificateId: selection.value.snapshot.certificateId, snapshotAt: selection.value.snapshot.snapshotAt, expectedSha256: selection.value.sha256 }),
      });
      if (!response.ok) {
        if (response.status === 409) { await loadDetail(detail.id); setConfirmationError("changed"); return; }
        setConfirmationError("error"); return;
      }
      await loadDetail(detail.id);
      refreshOverview();
      setReveal("publication");
    } catch { setConfirmationError("error"); }
    finally { setConfirmationBusy(false); }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.indexOf(tab);
    const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length]
      : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (!next) return;
    event.preventDefault(); selectTab(next); tabRefs.current[next]?.focus();
  }

  const back = <Link href="/admin/passports" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />{t.backToQueue}</Link>;
  if (!detail || detail.id !== id) return <>
    <PageHeader title={detailError ? t.detailsError : t.loading}>{back}</PageHeader>
    {detailLoading && !detailError && <p role="status" className="text-sm text-ink-muted">{t.loading}</p>}
    {detailError && <p role="alert" className="text-sm text-danger"><button type="button" onClick={() => void loadDetail(id)} className="underline">{t.refresh}</button></p>}
  </>;

  const decided = ["APPROVED", "PUBLISHING", "PUBLISHED"].includes(detail.status);
  const stopped = detail.status === "REJECTED" || detail.status === "CORRECTION_REQUIRED";
  const steps: { label: string; done: boolean; current: boolean }[] = [
    { label: s.steps.submitted, done: Boolean(detail.submittedAt), current: false },
    { label: s.steps.decided, done: decided || stopped, current: detail.status === "SUBMITTED" },
    { label: s.steps.snapshot, done: Boolean(publicConfirmation), current: decided && !publicConfirmation },
    { label: s.steps.issued, done: Boolean(detail.issued), current: Boolean(publicConfirmation) && !detail.issued },
  ];
  const counts: Partial<Record<Tab, number>> = { evidence: detail.evidence.length, history: detail.audit.length };

  const decisionPanel = (detail.status === "SUBMITTED" || detail.status === "APPROVED") && <Panel level={3} title={t.decision}>
    {detail.issued && <p role="status" className="text-sm text-ink-muted">{t.issuedDecision}</p>}
    {detail.status === "SUBMITTED" && <div className="space-y-2">
      <label className="block text-sm">{t.assign}<select value={reviewerId} onChange={event => setReviewerId(event.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">{t.unassigned}</option>{overview?.reviewers.map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}</select></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void post("assign", { reviewerId: reviewerId || null })} disabled={busy || reviewerId === (detail.reviewer?.id ?? "")} className={buttonClass.secondary}>{t.assign}</button>
        {detail.reviewer?.id !== actorId && <button type="button" onClick={() => void post("assign", { reviewerId: actorId })} disabled={busy} className={buttonClass.primary}>{t.claim}</button>}
      </div>
    </div>}
    {detail.reviewer?.id === actorId && !detail.issued && <form className={cn("space-y-3", detail.status === "SUBMITTED" && "mt-5 border-t border-border pt-4")} onSubmit={event => { event.preventDefault(); if (decision !== "APPROVED" && !note.trim()) { setActionError(t.reasonRequired); return; } const approving = decision === "APPROVED"; void post("decision", { decision, note: note.trim() }).then(done => { if (done && approving) { selectTab("publication"); setReveal("preview"); } }); }}>
      <fieldset disabled={busy || confirmationBusy}><legend className="text-sm font-medium">{t.decision}</legend>
        <div className="mt-2 space-y-1.5 text-sm">{(detail.status === "SUBMITTED" ? [["APPROVED", t.approve], ["REJECTED", t.reject], ["CORRECTION_REQUIRED", t.requestCorrection]] : [["CORRECTION_REQUIRED", t.requestCorrection]]).map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="decision" checked={decision === value} onChange={() => setDecision(value as typeof decision)} />{label}</label>)}</div>
      </fieldset>
      <label className="block text-sm">{t.note}<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={3} disabled={busy || confirmationBusy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label>
      <button type="submit" disabled={busy || confirmationBusy} className={cn(buttonClass.primary, "w-full")}>{t.saveDecision}</button>
    </form>}
    {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}
  </Panel>;

  const panels: Record<Tab, ReactNode> = {
    data: <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <Panel level={3} title={t.farmerField}><Fields values={[[t.name, detail.farmer.legalName], [t.publicFarmLabel, detail.publicFarmLabel], [t.registration, detail.farmer.registrationId], [t.publicFieldReference, detail.field.publicReference], [t.crop, crop(detail.field.crop)], [t.area, detail.field.areaHectares], [t.gps, detail.field.gpsCoords], [t.cadastral, detail.field.cadastralNumber], [t.owner, detail.farmer.contactName], ["Email", detail.farmer.contactEmail], ["Phone", detail.farmer.contactPhone]]} /></Panel>
        <Panel level={3} title={t.treatment}><Fields values={[[t.type, code(translations.treatmentTypes, detail.treatment?.treatmentType)], [t.date, detail.treatment?.treatmentDate], [t.time, detail.treatment?.treatmentTime], [t.timeZone, detail.treatment?.timeZone], [t.treatedArea, detail.treatment?.treatedAreaHectares], [t.drone, detail.treatment?.droneModel], [t.operator, detail.treatment?.operator], [t.pilotCert, detail.treatment?.pilotCert], [t.note, detail.treatment?.notes]]} /></Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel level={3} title={t.meteo}><Fields values={[[t.temperature, detail.meteo?.temperatureCelsius], [t.humidity, detail.meteo?.humidityPercent], [t.wind, detail.meteo?.windSpeedMps], [t.rainfall, detail.meteo?.rainfallMm]]} /></Panel>
          <Panel level={3} title={t.chemical}><Fields values={[[t.product, detail.chemical?.product], [t.activeSubstance, detail.chemical?.activeSubstance], [t.dose, detail.chemical?.dosePerHa], [t.doseUnit, code(translations.codes.doseUnit, detail.chemical?.doseUnit)], [t.volume, detail.chemical?.workingVolume], [t.manufacturer, detail.chemical?.manufacturer], [t.registration, detail.chemical?.registrationNo], [t.supplier, detail.chemical?.supplierName]]} /></Panel>
        </div>
      </div>
      <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
        {decisionPanel}
        {detail.reviewNote && <Panel level={3} title={t.note}><p className="whitespace-pre-wrap text-sm">{detail.reviewNote}</p></Panel>}
      </div>
    </div>,
    evidence: <div className="space-y-6">
      <Panel level={3} title={t.evidence}>
        {!detail.evidence.length ? <p className="text-sm text-ink-muted">{t.noEvidence}</p> : <ul className="divide-y divide-border">{detail.evidence.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2.5"><FileText className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden /><span className="min-w-0"><span className="block break-all font-medium">{file.filename}</span><span className="text-ink-muted">{code(evidenceLabel, file.kind)} · {code(evidenceLabel, file.status)}</span></span></span>
          {file.status === "READY" && !detail.issued && <a href={`/api/admin/passports/${detail.id}/evidence/${file.id}/preview`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Download className="h-4 w-4" aria-hidden />{t.download}</a>}
        </li>)}</ul>}
        {detail.issued && <EvidenceAccess passportId={detail.id} />}
      </Panel>
      <PreservationHolds key={detail.id} passportId={detail.id} />
    </div>,
    publication: detail.status !== "APPROVED" ? <Panel><p className="flex items-center gap-2 text-sm text-ink-muted"><Lock className="h-4 w-4" aria-hidden />{s.publicationLocked}</p></Panel>
      : <RevealStep active={reveal === "preview"}><section className="rounded-2xl border border-border bg-surface p-5 shadow-soft" aria-labelledby="public-preview-heading">
        <h3 id="public-preview-heading" className="text-base font-semibold">{t.publicPreview.title}</h3>
        {confirmationLoading && <p role="status" className="mt-2 text-sm">{t.loading}</p>}
        {confirmationError && <p role="alert" className="mt-2 text-sm text-danger">{{ load: t.publicPreview.confirmationLoadError, changed: t.publicPreview.confirmChanged, error: t.publicPreview.confirmError }[confirmationError]} <button type="button" onClick={() => void loadDetail(detail.id)} className="underline">{t.refresh}</button></p>}
        {publicConfirmation && <div className="mt-4"><h4 className="font-semibold">{t.publicPreview.confirmedTitle}</h4><p className="mt-1 text-sm text-ink-muted">{t.publicPreview.confirmedAt}: {date(publicConfirmation.confirmedAt)}</p>{!detail.issued && <div className="mt-3 flex flex-wrap gap-4 text-sm"><Link href={`/admin/passports/${encodeURIComponent(detail.id)}/certificate`} className="font-medium text-brand-700 underline">{t.confirmedViews.openCertificate}</Link><Link href={`/admin/passports/${encodeURIComponent(detail.id)}/verification`} className="font-medium text-brand-700 underline">{t.confirmedViews.openVerification}</Link></div>}<PublicSnapshotView preview={publicConfirmation.preview} confirmed note={detail.issued ? t.publicPreview.issuedRecord : undefined} /></div>}
        {publicConfirmation && <RevealStep active={reveal === "publication"}><PublicationPanel key={`${detail.id}:${publicConfirmation.id}`} passportId={detail.id} confirmation={publicConfirmation} disabled={busy || confirmationBusy} /></RevealStep>}
        {!publicConfirmation && !confirmationLoading && !confirmationError && <>
          <p className="mt-2 text-sm text-ink-muted">{t.publicPreview.hint}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">{t.publicPreview.weatherSource}<select value={weatherFileId} onChange={event => { previewRequestId.current += 1; setPreviewBusy(false); setWeatherFileId(event.target.value); setPublicPreview(null); setPreviewError(""); setConfirmationChecked(false); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">{t.publicPreview.choose}</option>{detail.evidence.filter(file => file.kind === "METEO" && file.status === "READY").map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}</select></label>
            <label className="text-sm">{t.publicPreview.chemicalSource}<select value={chemicalFileId} onChange={event => { previewRequestId.current += 1; setPreviewBusy(false); setChemicalFileId(event.target.value); setPublicPreview(null); setPreviewError(""); setConfirmationChecked(false); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">{t.publicPreview.choose}</option>{detail.evidence.filter(file => file.kind === "CHEMICAL" && file.status === "READY").map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}</select></label>
          </div>
          <button type="button" onClick={() => void loadPublicPreview()} disabled={!weatherFileId || !chemicalFileId || previewBusy} className={cn(buttonClass.primary, "mt-4")}>{previewBusy ? t.publicPreview.loading : t.publicPreview.show}</button>
          {previewError && <p role="alert" className="mt-3 text-sm text-danger">{previewError}</p>}
          {publicPreview && publicPreview.passportId === detail.id && publicPreview.passportVersion === detail.version && publicPreview.weatherFileId === weatherFileId && publicPreview.chemicalFileId === chemicalFileId && <><PublicSnapshotView preview={publicPreview.value} />{detail.reviewer?.id === actorId && <div className="mt-4 space-y-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmationChecked} onChange={event => setConfirmationChecked(event.target.checked)} disabled={confirmationBusy} className="mt-1" /><span>{t.publicPreview.confirmCheck}</span></label><button type="button" onClick={() => void confirmPreview()} disabled={!confirmationChecked || confirmationBusy || busy} className={buttonClass.primary}>{confirmationBusy ? t.publicPreview.confirming : t.publicPreview.confirm}</button></div>}</>}
        </>}
      </section></RevealStep>,
    history: <Panel level={3} title={t.audit}>
      {!detail.audit.length ? <p className="text-sm text-ink-muted">{t.noAudit}</p> : <ol className="relative space-y-4 border-l border-border pl-5">{detail.audit.map(event => <li key={event.id} className="relative text-sm">
        <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-500" aria-hidden />
        <p><span className="font-medium">{code(translations.codes.audit, event.action)}</span> · {event.actorName}</p>
        <p className="text-xs text-ink-muted"><time dateTime={event.createdAt}>{date(event.createdAt)}</time></p>
        {event.note && <p className="mt-1 whitespace-pre-wrap text-ink-muted">{event.note}</p>}
      </li>)}</ol>}
    </Panel>,
  };

  return <>
    <PageHeader title={detail.farmer.legalName || t.untitled}>{back}</PageHeader>
    <div className="-mt-3 mb-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted"><StatusBadge status={detail.status} /><span>{crop(detail.field.crop) || "—"}</span></div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-soft md:grid-cols-4">
        <div className="min-w-0"><dt className="text-xs text-ink-muted">{t.owner}</dt><dd className="break-words">{detail.owner.name}<span className="block break-all text-xs text-ink-muted">{detail.owner.email}</span></dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink-muted">{t.reviewer}</dt><dd>{detail.reviewer ? detail.reviewer.id === actorId ? s.assignedToYou : detail.reviewer.name : t.unassigned}</dd></div>
        <div><dt className="text-xs text-ink-muted">{t.submittedAt}</dt><dd>{date(detail.submittedAt)}</dd></div>
        <div><dt className="text-xs text-ink-muted">{t.reviewedAt}</dt><dd>{date(detail.reviewedAt)}</dd></div>
      </dl>
      <ol aria-label={s.steps.label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => <li key={step.label} aria-current={step.current ? "step" : undefined}
          className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", step.done ? "border-brand-200 bg-brand-50 text-brand-900" : step.current ? "border-sky-300 bg-sky-50 font-medium text-sky-900" : "border-border bg-surface text-ink-muted")}>
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", step.done ? "bg-brand-700 text-white" : step.current ? "bg-sky-700 text-white" : "bg-surface-2")}>{step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}</span>
          <span className="min-w-0">{step.label}{step.done ? <span className="sr-only"> ({s.steps.done})</span> : step.current ? <span className="sr-only"> ({s.steps.current})</span> : null}</span>
        </li>)}
      </ol>
    </div>

    <div role="tablist" aria-label={s.tabs.label} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map(key => <button key={key} ref={element => { tabRefs.current[key] = element; }} type="button" role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
        onClick={() => selectTab(key)} onKeyDown={onTabKey}
        className={cn("-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", tab === key ? "border-brand-700 text-brand-800" : "border-transparent text-ink-muted hover:text-ink")}>
        {s.tabs[key]}
        {counts[key] !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-ink-muted">{counts[key]}</span>}
      </button>)}
    </div>
    {tabs.map(key => <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={tab !== key}><h2 className="sr-only">{s.tabs[key]}</h2>{panels[key]}</div>)}
  </>;
}
