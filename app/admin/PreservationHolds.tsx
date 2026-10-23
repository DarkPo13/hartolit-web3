"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale, useT } from "@/lib/i18n/context";

type Hold = { id: string; reference: string; reason: string; placedBy: string; placedAt: string; releasedAt: string | null; releasedBy: string | null;
  releaseNote: string | null; active: boolean };

/** Claim/dispute preservation holds: block deletion and purging of the record,
 * its farm/field linkage and evidence until released. Placement and release are audited.
 */
export function PreservationHolds({ passportId }: { passportId: string }) {
  const t = useT().holds;
  const { locale } = useLocale();
  const heading = useId();
  const base = `/api/admin/passports/${encodeURIComponent(passportId)}/holds`;
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [error, setError] = useState<"loadError" | "actionError" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [placeChecked, setPlaceChecked] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: { holds: Hold[] } = await response.json();
      if (alive.current) { setHolds(result.holds); setError(null); }
    } catch { if (alive.current) setError("loadError"); }
  }, [base]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  async function mutate(method: "POST" | "DELETE", body: object) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(base, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      if (alive.current && method === "POST") { setReference(""); setReason(""); setPlaceChecked(false); }
    } catch { if (alive.current) setError("actionError"); }
    finally { if (alive.current) { setBusy(false); await load(); } }
  }

  const date = (value: string) => new Date(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US");
  const active = holds?.filter(row => row.active) ?? [];
  const input = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2";
  return <section aria-labelledby={heading} className="rounded-2xl border border-border bg-surface p-5 text-sm">
    <h3 id={heading} className="font-semibold">{t.title}</h3>
    <p className="mt-2 text-ink-muted">{t.hint}</p>
    {error && <p role="alert" className="mt-2 text-danger">{t[error]}</p>}
    <p role="status" className={`mt-3 font-medium ${active.length ? "text-danger" : "text-ink-muted"}`}>{active.length ? t.held : t.notHeld}</p>
    {!!holds?.length && <ul className="mt-2 divide-y divide-border">{holds.map(hold => <li key={hold.id} className="space-y-1 py-2">
      <p className="font-medium">{hold.reference} · {hold.active ? t.active : t.released}</p>
      <p className="text-ink-muted">{hold.reason}</p>
      <p className="text-ink-muted">{hold.placedBy} · {date(hold.placedAt)}{hold.releasedAt ? ` → ${hold.releasedBy} · ${date(hold.releasedAt)} · ${hold.releaseNote}` : ""}</p>
      {hold.active && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1">{t.releaseNote}<input value={notes[hold.id] ?? ""} maxLength={500} onChange={event => setNotes({ ...notes, [hold.id]: event.target.value })} className={input} /></label>
        <Button type="button" variant="outline" size="sm" disabled={busy || (notes[hold.id] ?? "").trim().length < 3}
          onClick={() => void mutate("DELETE", { holdId: hold.id, note: (notes[hold.id] ?? "").trim(), acknowledgement: "RELEASE_PRESERVATION_HOLD" })}>{t.release}</Button>
      </div>}
    </li>)}</ul>}
    <details className="mt-3"><summary className="cursor-pointer font-medium text-brand-700">{t.place}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>{t.reference}<input value={reference} maxLength={200} onChange={event => setReference(event.target.value)} className={input} /></label>
        <label className="sm:col-span-2">{t.reason}<textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)} className={input} /></label>
      </div>
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={placeChecked} onChange={event => setPlaceChecked(event.target.checked)} /><span>{t.consent}</span></label>
      <Button type="button" className="mt-3" disabled={busy || !placeChecked || reference.trim().length < 2 || reason.trim().length < 3}
        onClick={() => void mutate("POST", { reference: reference.trim(), reason: reason.trim(), acknowledgement: "PLACE_PRESERVATION_HOLD" })}>{t.placeButton}</Button>
    </details>
  </section>;
}
