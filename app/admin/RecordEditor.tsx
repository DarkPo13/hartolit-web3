"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/lib/i18n/context";

type Kind = "farmers" | "fields";
type RecordDetail = {
  id: string; kind: Kind; updatedAt: string; archivedAt: string | null;
  owner: { name: string; email: string }; farmerName?: string;
  data: Record<string, string | number | null>;
  duplicateCount: number; passports: { id: string; status: string }[];
};

export function RecordEditor({ kind, id, onClose, onChanged, onOpenPassport }: {
  kind: Kind; id: string; onClose: () => void; onChanged: () => void; onOpenPassport: (id: string) => void;
}) {
  const t = useT();
  const m = t.management;
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [data, setData] = useState<RecordDetail["data"]>({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"" | "load" | "save">("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setNotice(""); setRecord(null); setData({});
    void fetch(`/api/admin/records/${kind}/${id}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ record: RecordDetail }>; })
      .then((result) => { setRecord(result.record); setData(result.record.data); })
      .catch(() => { if (!controller.signal.aborted) setError("load"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, id, revision]);

  const fields: [string, string, number, "text" | "email" | "number"][] = kind === "farmers"
    ? [["legalName", m.legalName, 200, "text"], ["registrationId", m.registrationId, 32, "text"], ["contactName", m.contactName, 200, "text"], ["contactEmail", m.contactEmail, 320, "email"], ["contactPhone", m.contactPhone, 40, "text"]]
    : [["label", m.label, 200, "text"], ["areaHectares", m.areaHectares, 20, "number"], ["gpsCoords", m.gpsCoords, 80, "text"], ["cadastralNumber", m.cadastralNumber, 40, "text"], ["crop", m.crop, 100, "text"]];
  const editable = Boolean(record && !record.archivedAt && record.passports.every((passport) => passport.status === "DRAFT"));
  const canArchive = Boolean(record && record.passports.every((passport) => passport.status !== "DRAFT" && passport.status !== "SUBMITTED"));

  async function mutate(path: string, method: "PATCH" | "POST", body: object, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json() as { record: RecordDetail };
      setRecord(result.record); setData(result.record.data); setNotice(success); onChanged();
    } catch { setError("save"); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || !editable) return;
    void mutate(`/api/admin/records/${kind}/${id}`, "PATCH", { updatedAt: record.updatedAt, data }, m.saved);
  }

  function archive() {
    if (!record || !canArchive || (!record.archivedAt && !window.confirm(m.confirmArchive))) return;
    void mutate(`/api/admin/records/${kind}/${id}`, "POST", { updatedAt: record.updatedAt, archived: !record.archivedAt }, record.archivedAt ? m.restored : m.archived);
  }

  return <section className="mt-5 rounded-xl border border-border bg-surface p-4" aria-labelledby="record-detail-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="record-detail-heading" className="font-semibold">{m.editTitle}</h3><button type="button" onClick={onClose} className="text-sm text-brand-700 underline">{m.close}</button></div>
    {loading ? <p role="status" className="mt-3 text-sm">{t.review.loading}</p> : !record ? <button type="button" onClick={() => setRevision((value) => value + 1)} className="mt-3 text-sm text-brand-700 underline">{t.review.refresh}</button> : <>
      <p className="mt-2 break-all text-sm text-ink-muted">{m.owner}: {record.owner.name} ({record.owner.email}){record.farmerName ? ` · ${record.farmerName}` : ""}</p>
      {record.duplicateCount > 0 && <p role="status" className="mt-3 rounded-lg border border-amber-300 p-3 text-sm">{m.duplicate} {record.duplicateCount}</p>}
      {!editable && <p className="mt-3 text-sm text-ink-muted">{record.archivedAt ? m.archivedLocked : m.locked}</p>}
      <form onSubmit={save} className="mt-4 space-y-3"><fieldset disabled={!editable || busy} className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label, max, type]) => <label key={key} className="block text-sm">{label}<input type={type} value={data[key] ?? ""} maxLength={type === "number" ? undefined : max} min={type === "number" ? 0 : undefined} max={type === "number" ? 99999999.9999 : undefined} step={type === "number" ? "0.0001" : undefined} onChange={(event) => setData((old) => ({ ...old, [key]: type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label>)}</fieldset>
        {editable && <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{m.save}</button>}
      </form>
      {canArchive && <button type="button" onClick={archive} disabled={busy} className="mt-3 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{record.archivedAt ? m.restore : m.archive}</button>}
      <h4 className="mt-5 text-sm font-semibold">{m.linkedPassports}</h4>
      {!record.passports.length ? <p className="text-sm text-ink-muted">{t.review.noRecords}</p> : <ul className="mt-2 space-y-2">{record.passports.map((passport) => <li key={passport.id} className="flex flex-wrap items-center gap-2 text-sm"><button type="button" onClick={() => onOpenPassport(passport.id)} className="break-all text-brand-700 underline">{passport.id}</button><span>{passport.status}</span></li>)}</ul>}
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error === "load" ? t.review.loadError : m.saveError}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-brand-700">{notice}</p>}
  </section>;
}
