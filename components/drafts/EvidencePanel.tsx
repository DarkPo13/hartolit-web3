"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";

type Kind = "METEO" | "CHEMICAL" | "OTHER";
type Evidence = {
  id: string;
  kind: Kind;
  filename: string;
  sizeBytes: number;
  status: "PENDING" | "SCANNING" | "QUARANTINED" | "READY" | "REJECTED";
  rejectionCode: string | null;
};

const MAX_BYTES = 10 * 1024 * 1024;
const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  json: "application/json", csv: "text/csv", txt: "text/plain", xml: "application/xml",
};
const displaySize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export function EvidencePanel({ draftId }: { draftId: string }) {
  const t = useT().evidence;
  const [files, setFiles] = useState<Evidence[]>([]);
  const [kind, setKind] = useState<Kind>("METEO");
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/drafts/${encodeURIComponent(draftId)}/evidence`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setFiles((await response.json()).files as Evidence[]);
      setError(null);
    } catch { setError(t.loadError); }
    finally { setLoading(false); }
  }, [base, t.loadError]);

  useEffect(() => { void load(); }, [load]);

  async function complete(fileId: string) {
    const response = await fetch(`${base}/${encodeURIComponent(fileId)}/complete`, { method: "POST" });
    if (!response.ok) throw new Error();
    await load();
  }

  async function upload() {
    if (!selected || busy) return;
    const ext = selected.name.split(".").at(-1)?.toLowerCase() ?? "";
    const contentType = mimeByExtension[ext];
    if (!contentType || selected.size < 1 || selected.size > MAX_BYTES) { setError(t.fileLimit); return; }
    setBusy(true);
    setError(null);
    try {
      const sha256 = await fileHash(selected);
      const reservation = await fetch(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, filename: selected.name, contentType, sizeBytes: selected.size, sha256 }),
      });
      if (!reservation.ok) throw new Error();
      const { file, upload: signed } = await reservation.json() as { file: Evidence; upload: { url: string; fields: Record<string, string> } };
      setFiles((current) => [file, ...current]);
      const form = new FormData();
      Object.entries(signed.fields).forEach(([key, value]) => form.append(key, value));
      form.append("file", selected, selected.name);
      const transferred = await fetch(signed.url, { method: "POST", body: form });
      if (!transferred.ok) throw new Error();
      await complete(file.id);
      setSelected(null);
      if (input.current) input.current.value = "";
    } catch {
      await load();
      setError(t.uploadError);
    } finally { setBusy(false); }
  }

  async function retry(fileId: string) {
    setBusy(true);
    setError(null);
    try { await complete(fileId); }
    catch { await load(); setError(t.uploadError); }
    finally { setBusy(false); }
  }

  async function remove(fileId: string) {
    if (!window.confirm(t.confirmRemove)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      await load();
    } catch { setError(t.removeError); }
    finally { setBusy(false); }
  }

  const statusLabels = { PENDING: t.pending, SCANNING: t.scanning, QUARANTINED: t.quarantined, READY: t.ready, REJECTED: t.rejected };
  const kindLabels = { METEO: t.meteo, CHEMICAL: t.chemical, OTHER: t.other };

  return <section className="rounded-2xl border border-border bg-surface p-5 md:p-6" aria-labelledby="evidence-heading">
    <h2 id="evidence-heading" className="text-xl font-semibold text-ink">{t.title}</h2>
    <p className="mt-2 text-sm text-ink-muted">{t.description}</p>
    <div className="mt-5 flex flex-wrap items-end gap-3">
      <label className="text-sm text-ink">{t.kind}
        <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} disabled={busy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2">
          <option value="METEO">{t.meteo}</option><option value="CHEMICAL">{t.chemical}</option><option value="OTHER">{t.other}</option>
        </select>
      </label>
      <label className="min-w-48 flex-1 text-sm text-ink">{t.chooseFile}
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.json,.csv,.txt,.xml" onChange={(event) => setSelected(event.target.files?.[0] ?? null)} disabled={busy} className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2" />
      </label>
      <button type="button" onClick={() => void upload()} disabled={!selected || busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? t.uploading : t.upload}</button>
    </div>
    <p className="mt-2 text-xs text-ink-muted">{t.fileLimit}</p>
    {error && <div role="alert" className="mt-3 text-sm text-danger">{error} <button type="button" onClick={() => void load()} className="font-medium underline">{t.retry}</button></div>}
    {loading ? <p role="status" className="mt-5 text-sm text-ink-muted">{t.loading}</p> : files.length === 0 ? <p className="mt-5 text-sm text-ink-muted">{t.empty}</p> :
      <ul className="mt-5 divide-y divide-border">
        {files.map((file) => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0"><p className="break-all font-medium text-ink">{file.filename}</p><p className="text-ink-muted">{kindLabels[file.kind]} · {displaySize(file.sizeBytes)} · {statusLabels[file.status]}</p></div>
          <div className="flex gap-3">
            {file.status === "READY" ? <a href={`${base}/${encodeURIComponent(file.id)}/preview`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">{t.download}</a> :
              file.status === "QUARANTINED" || file.status === "PENDING" ? <button type="button" disabled={busy} onClick={() => void retry(file.id)} className="font-medium text-brand-700 underline disabled:opacity-50">{t.retry}</button> : null}
            <button type="button" disabled={busy || file.status === "SCANNING"} onClick={() => void remove(file.id)} className="font-medium text-danger underline disabled:opacity-50">{t.remove}</button>
          </div>
        </li>)}
      </ul>}
  </section>;
}
