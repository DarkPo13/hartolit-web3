"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Step1Form } from "@/components/wizard/Step1Form";
import { EvidencePanel } from "@/components/drafts/EvidencePanel";
import { ReviewStatusPanel } from "@/components/drafts/ReviewStatusPanel";
import { fromDraftData, toDraftData } from "@/lib/drafts/client";
import type { DraftListItem, DraftRecord } from "@/lib/drafts/schema";
import { draftFingerprint, useWizardStore } from "@/lib/store";
import { useT } from "@/lib/i18n/context";

type SaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error" | "conflict" | "invalid";

async function getDraft(id: string): Promise<DraftRecord> {
  const response = await fetch(`/api/drafts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error(`Draft fetch failed: ${response.status}`), { status: response.status });
  return (await response.json()).draft as DraftRecord;
}

export function DraftWorkspace() {
  const t = useT();
  const state = useWizardStore();
  const replaceDraft = useWizardStore((s) => s.replaceDraft);
  const setDraftSync = useWizardStore((s) => s.setDraftSync);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [legacyCache, setLegacyCache] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [submitIssues, setSubmitIssues] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState(false);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fingerprint = draftFingerprint(state);
  const dirty = !!state.draftSync && fingerprint !== state.draftSync.syncedFingerprint;

  const openDraft = useCallback(async (id: string, preserveCache = false) => {
    const record = await getDraft(id);
    setSubmitIssues([]);
    setSubmitError(false);
    setDrafts((items) => items.some((item) => item.id === record.id) ? items : [{
      id: record.id, status: "DRAFT", version: record.version, updatedAt: record.updatedAt,
      farmerName: record.data.farmer.farmerName, crop: record.data.farmer.crop,
    }, ...items]);
    const cached = useWizardStore.getState().draftSync;
    if (preserveCache && cached?.id === id && cached.cacheDirty) {
      setSelectedId(id);
      setStatus(record.version === cached.version ? "unsaved" : "conflict");
      return;
    }
    replaceDraft(fromDraftData(record.data), record.id, record.version);
    setReviewNote(record.reviewNote);
    setSelectedId(id);
    setStatus("saved");
    setLegacyCache(false);
  }, [replaceDraft]);

  const load = useCallback(async () => {
    setLoadError(false);
    setStatus("loading");
    try {
      const response = await fetch("/api/drafts", { cache: "no-store" });
      if (!response.ok) throw new Error(`Draft list failed: ${response.status}`);
      const items = (await response.json()).drafts as DraftListItem[];
      setDrafts(items);
      const cached = useWizardStore.getState().draftSync;
      if (cached?.id) {
        try { await openDraft(cached.id, true); }
        catch (error) {
          if ((error as { status?: number }).status !== 409 && (error as { status?: number }).status !== 404) throw error;
          useWizardStore.getState().reset();
          if (items[0]) await openDraft(items[0].id);
          else setStatus("saved");
        }
      } else if (["farmer", "treatment", "meteo", "chemical"].some((key) => Object.keys(useWizardStore.getState()[key as "farmer" | "treatment" | "meteo" | "chemical"]).length)) {
        setLegacyCache(true);
        setStatus("unsaved");
      } else if (items[0]) {
        await openDraft(items[0].id);
      } else {
        setStatus("saved");
      }
    } catch {
      setLoadError(true);
      setStatus("error");
    }
  }, [openDraft]);

  useEffect(() => { void load(); }, [load]);

  const saveNow = useCallback(async (versionOverride?: number) => {
    if (inFlight.current) return;
    const current = useWizardStore.getState();
    const sync = current.draftSync;
    if (!sync) return;
    const data = toDraftData(current);
    if (!data) { setStatus("invalid"); return; }
    const sentFingerprint = draftFingerprint(current);
    inFlight.current = true;
    setStatus("saving");
    try {
      const response = await fetch(`/api/drafts/${encodeURIComponent(sync.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: versionOverride ?? sync.version, data }),
      });
      if (response.status === 409) { setStatus("conflict"); return; }
      if (!response.ok) throw new Error(`Draft save failed: ${response.status}`);
      const record = (await response.json()).draft as DraftRecord;
      setDraftSync({ id: record.id, version: record.version, syncedFingerprint: sentFingerprint });
      setDrafts((items) => {
        const updated: DraftListItem = {
          id: record.id, status: "DRAFT", version: record.version, updatedAt: record.updatedAt,
          farmerName: record.data.farmer.farmerName, crop: record.data.farmer.crop,
        };
        return [updated, ...items.filter((item) => item.id !== updated.id)];
      });
      setStatus(draftFingerprint(useWizardStore.getState()) === sentFingerprint ? "saved" : "unsaved");
    } catch { setStatus("error"); }
    finally { inFlight.current = false; }
  }, [setDraftSync]);

  useEffect(() => {
    if (!selectedId || !dirty || status === "loading" || status === "saving" || status === "error" || status === "conflict" || status === "invalid") return;
    const timer = window.setTimeout(() => void saveNow(), 750);
    return () => window.clearTimeout(timer);
  }, [selectedId, dirty, fingerprint, state.draftSync?.version, status, saveNow]);

  async function create(importLocal = false) {
    if (busy || inFlight.current || (selectedId && dirty) || (legacyCache && !importLocal)) return;
    const local = importLocal ? {
      farmer: useWizardStore.getState().farmer,
      treatment: useWizardStore.getState().treatment,
      meteo: useWizardStore.getState().meteo,
      chemical: useWizardStore.getState().chemical,
    } : null;
    const parsedLocal = local ? toDraftData(local) : null;
    if (local && !parsedLocal) { setStatus("invalid"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/drafts", { method: "POST" });
      if (!response.ok) throw new Error(`Draft create failed: ${response.status}`);
      const record = (await response.json()).draft as DraftRecord;
      replaceDraft(fromDraftData(record.data), record.id, record.version);
      setDrafts((items) => [{
        id: record.id, status: "DRAFT", version: record.version, updatedAt: record.updatedAt,
        farmerName: "", crop: "",
      }, ...items]);
      setSelectedId(record.id);
      setLegacyCache(false);
      setStatus("saved");
      if (parsedLocal) {
        const safeLocal = fromDraftData(parsedLocal);
        const store = useWizardStore.getState();
        store.setFarmer(safeLocal.farmer);
        store.setTreatment(safeLocal.treatment);
        store.setMeteo(safeLocal.meteo);
        store.setChemical(safeLocal.chemical);
        setStatus("unsaved");
      }
    } catch { setStatus("error"); setLoadError(true); }
    finally { setBusy(false); }
  }

  async function choose(id: string) {
    if (id === selectedId || busy || dirty || inFlight.current || status === "error" || status === "conflict") return;
    setBusy(true);
    try { await openDraft(id); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setBusy(false); }
  }

  async function reloadServer() {
    if (!selectedId) return;
    setBusy(true);
    try { await openDraft(selectedId); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setBusy(false); }
  }

  async function keepChanges() {
    if (!selectedId) return;
    setBusy(true);
    try { const latest = await getDraft(selectedId); await saveNow(latest.version); }
    catch { setStatus("error"); }
    finally { setBusy(false); }
  }

  async function submit() {
    const sync = useWizardStore.getState().draftSync;
    if (!sync || busy || dirty || status !== "saved") return;
    setBusy(true);
    setSubmitIssues([]);
    setSubmitError(false);
    try {
      const response = await fetch(`/api/passports/${encodeURIComponent(sync.id)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: sync.version }) });
      if (response.status === 409) { setStatus("conflict"); return; }
      if (!response.ok) {
        const payload = await response.json();
        if (response.status === 422 && Array.isArray(payload.issues)) { setSubmitIssues(payload.issues); return; }
        throw new Error();
      }
      useWizardStore.getState().reset();
      setSelectedId(null);
      setReviewNote(null);
      setReviewRevision((value) => value + 1);
      await load();
    } catch { setSubmitError(true); }
    finally { setBusy(false); }
  }

  const statusText = status === "loading" ? t.drafts.loading
    : status === "saving" ? t.drafts.saving
    : status === "saved" ? t.drafts.saved
    : status === "conflict" ? t.drafts.conflict
    : status === "error" ? t.drafts.saveError
    : status === "invalid" ? t.drafts.invalid
    : t.drafts.unsaved;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 md:p-6">
        <h2 className="text-xl font-semibold text-ink">{t.drafts.title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t.drafts.description}</p>
        {loadError ? (
          <div className="mt-4" role="alert">
            <p className="text-sm text-danger">{t.drafts.loadError}</p>
            <button type="button" onClick={() => void load()} className="mt-2 text-sm font-medium text-brand-700 underline">{t.drafts.retry}</button>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            {drafts.length > 0 && <label className="min-w-52 flex-1 text-sm text-ink">
              {t.drafts.choose}
              <select value={selectedId ?? ""} onChange={(event) => void choose(event.target.value)} disabled={busy || dirty || status === "saving" || status === "error" || status === "conflict"} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50">
                {!selectedId && <option value="">{t.drafts.choose}</option>}
                {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.farmerName || t.drafts.untitled} · {new Date(draft.updatedAt).toLocaleDateString()}</option>)}
              </select>
            </label>}
            <button type="button" onClick={() => void create()} disabled={busy || dirty || legacyCache || status === "saving" || status === "error" || status === "conflict"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{t.drafts.newDraft}</button>
          </div>
        )}
        {!loadError && !drafts.length && !legacyCache && status !== "loading" && <p className="mt-4 text-sm text-ink-muted">{t.drafts.empty}</p>}
        {legacyCache && <button type="button" onClick={() => void create(true)} disabled={busy} className="mt-4 text-sm font-medium text-brand-700 underline disabled:opacity-50">{t.drafts.localImport}</button>}
        {selectedId && <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role={status === "error" || status === "conflict" || status === "invalid" ? "alert" : "status"} aria-live="polite" className={`text-sm ${status === "error" || status === "conflict" || status === "invalid" ? "text-danger" : "text-ink-muted"}`}>{statusText}</p>
          {(status === "error" || status === "invalid") && <button type="button" onClick={() => void saveNow()} className="text-sm font-medium text-brand-700 underline">{t.drafts.retry}</button>}
          {status === "conflict" && <>
            <button type="button" onClick={() => void reloadServer()} disabled={busy} className="text-sm font-medium text-brand-700 underline disabled:opacity-50">{t.drafts.reload}</button>
            <button type="button" onClick={() => void keepChanges()} disabled={busy} className="text-sm font-medium text-brand-700 underline disabled:opacity-50">{t.drafts.overwrite}</button>
          </>}
        </div>}
        {selectedId && reviewNote && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-ink" role="status">{t.review.previousNote}: {reviewNote}</p>}
        {selectedId && !loadError && <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-ink-muted">{t.review.submitHint}</p>
          <button type="button" onClick={() => void submit()} disabled={busy || dirty || status !== "saved"} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? t.review.submitting : t.review.submit}</button>
          {submitIssues.length > 0 && <div role="alert" className="mt-3 text-sm text-danger"><p>{t.review.missingIntro}</p><ul className="mt-1 list-disc pl-5">{submitIssues.map((issue) => <li key={issue}>{t.review.required[issue as keyof typeof t.review.required] ?? issue}</li>)}</ul></div>}
          {submitError && <p role="alert" className="mt-3 text-sm text-danger">{t.review.actionError}</p>}
        </div>}
      </section>
      {selectedId && !loadError && <Step1Form key={state.mockVersion} demoMode={false} />}
      {selectedId && !loadError && <EvidencePanel key={selectedId} draftId={selectedId} />}
      <ReviewStatusPanel revision={reviewRevision} onReopened={openDraft} />
    </div>
  );
}
