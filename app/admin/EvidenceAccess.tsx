"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale, useT } from "@/lib/i18n/context";

type Grant = { id: string; organization: string; basis: string; basisReference: string; purpose: string; scope: string; grantedBy: string;
  grantedAt: string; expiresAt: string; revokedAt: string | null; active: boolean };
type AccessData = { issued: boolean; files: { id: string; kind: string; filename: string }[]; grants: Grant[] };
const BASES = ["DATA_SUBJECT_CONSENT", "CONTRACT", "LEGAL_OBLIGATION", "LEGITIMATE_INTEREST"] as const;
const SCOPES = ["EVIDENCE", "MAPPING", "EVIDENCE_AND_MAPPING"] as const;

/** Issued records: staff release private evidence or mapping for a claim only
 * under a recorded, time-limited grant. Every download is audited server-side.
 */
export function EvidenceAccess({ passportId }: { passportId: string }) {
  const t = useT().evidenceAccess;
  const { locale } = useLocale();
  const heading = useId();
  const base = `/api/admin/passports/${encodeURIComponent(passportId)}`;
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState<"loadError" | "actionError" | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ organization: "", basis: "DATA_SUBJECT_CONSENT", basisReference: "", purpose: "", scope: "EVIDENCE", days: 14 });
  const [checked, setChecked] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${base}/evidence-access`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: AccessData = await response.json();
      if (alive.current) { setData(result); setError(null); }
    } catch { if (alive.current) setError("loadError"); }
  }, [base]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  async function mutate(method: "POST" | "DELETE", body: object) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${base}/evidence-access`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      if (method === "POST" && alive.current) { setChecked(false); setForm(current => ({ ...current, organization: "", basisReference: "", purpose: "" })); }
    } catch { if (alive.current) setError("actionError"); }
    finally { if (alive.current) { setBusy(false); await load(); } }
  }

  const date = (value: string) => new Date(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US");
  const valid = form.organization.trim().length >= 2 && form.basisReference.trim().length >= 2 && form.purpose.trim().length >= 3 && checked;
  const input = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2";
  return <section aria-labelledby={heading} className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2 p-4 text-sm">
    <h4 id={heading} className="font-semibold">{t.title}</h4>
    <p className="text-ink-muted">{t.hint}</p>
    {error && <p role="alert" className="text-danger">{t[error]}</p>}
    {data?.grants.length ? <ul className="divide-y divide-border">{data.grants.map(grant => <li key={grant.id} className="space-y-1 py-2">
      <p className="font-medium">{grant.organization} · {t.bases[grant.basis as keyof typeof t.bases]} · {t.scopes[grant.scope as keyof typeof t.scopes]}</p>
      <p className="text-ink-muted">{grant.basisReference} — {grant.purpose}</p>
      <p className="text-ink-muted">{grant.grantedBy} · {date(grant.grantedAt)} → {date(grant.expiresAt)}{grant.revokedAt ? ` · ${t.revoked} ${date(grant.revokedAt)}` : grant.active ? "" : ` · ${t.expired}`}</p>
      {grant.active && <div className="flex flex-wrap items-center gap-3">
        {grant.scope !== "MAPPING" && data.files.map(file => <a key={file.id} href={`${base}/evidence/${file.id}/preview?grantId=${grant.id}`} target="_blank" rel="noopener noreferrer"
          className="text-brand-700 underline">{t.download}: {file.filename} ({file.kind})</a>)}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate("DELETE", { grantId: grant.id })}>{t.revoke}</Button>
      </div>}
    </li>)}</ul> : <p className="text-ink-muted">{t.none}</p>}
    <details><summary className="cursor-pointer font-medium text-brand-700">{t.create}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>{t.organization}<input value={form.organization} maxLength={200} onChange={event => setForm({ ...form, organization: event.target.value })} className={input} /></label>
        <label>{t.basis}<select value={form.basis} onChange={event => setForm({ ...form, basis: event.target.value })} className={input}>
          {BASES.map(value => <option key={value} value={value}>{t.bases[value]}</option>)}</select></label>
        <label>{t.basisReference}<input value={form.basisReference} maxLength={200} onChange={event => setForm({ ...form, basisReference: event.target.value })} className={input} /></label>
        <label>{t.scope}<select value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value })} className={input}>
          {SCOPES.map(value => <option key={value} value={value}>{t.scopes[value]}</option>)}</select></label>
        <label className="sm:col-span-2">{t.purpose}<textarea value={form.purpose} maxLength={500} rows={2} onChange={event => setForm({ ...form, purpose: event.target.value })} className={input} /></label>
        <label>{t.days}<input type="number" min={1} max={30} value={form.days} onChange={event => setForm({ ...form, days: Math.min(30, Math.max(1, Number(event.target.value) || 1)) })} className={input} /></label>
      </div>
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={checked} onChange={event => setChecked(event.target.checked)} /><span>{t.consent}</span></label>
      <Button type="button" className="mt-3" disabled={!valid || busy} onClick={() => void mutate("POST", { ...form, organization: form.organization.trim(),
        basisReference: form.basisReference.trim(), purpose: form.purpose.trim(), acknowledgement: "RECORD_EVIDENCE_ACCESS_BASIS" })}>{t.record}</Button>
    </details>
  </section>;
}
