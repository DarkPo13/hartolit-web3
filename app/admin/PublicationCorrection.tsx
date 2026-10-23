"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocale, useT } from "@/lib/i18n/context";

type CorrectionData = {
  published: { id: string; tokenId: string | null; payloadHash: string } | null;
  correction: { id: string; correctionPassportId: string; correctionStatus: string; openedAt: string; replacementTokenId: string | null } | null;
};

/** Post-mint correction: the published record is never edited; it is linked to a
 * separately reviewed passport whose own publication will supersede it publicly.
 */
export function PublicationCorrection({ base, canWrite, disabled }: { base: string; canWrite: boolean; disabled: boolean }) {
  const t = useT().publicationCorrection;
  const { locale } = useLocale();
  const heading = useId();
  const [data, setData] = useState<CorrectionData | null>(null);
  const [error, setError] = useState<"loadError" | "actionError" | null>(null);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${base}/correction`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: CorrectionData = await response.json();
      if (alive.current) { setData(result); setError(null); }
    } catch { if (alive.current) setError("loadError"); }
  }, [base]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  async function open() {
    if (!data?.published || !checked || reason.trim().length < 3 || busy || disabled) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${base}/correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        publicationId: data.published.id, expectedSha256: data.published.payloadHash, reason: reason.trim(),
        acknowledgement: "OPEN_PUBLICATION_CORRECTION" }) });
      if (!response.ok) throw new Error();
    } catch { if (alive.current) setError("actionError"); }
    finally { if (alive.current) { setBusy(false); await load(); } }
  }

  if (!data?.published && !error) return null;
  const date = (value: string) => new Date(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US");
  return <section aria-labelledby={heading} className="space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
    <h5 id={heading} className="font-semibold">{t.title}</h5>
    <p className="text-ink-muted">{t.hint}</p>
    {error && <p role="alert" className="text-danger">{t[error]}</p>}
    {data?.correction ? <div role="status" className="space-y-1">
      <p className="font-medium">{t.opened} {date(data.correction.openedAt)}</p>
      <p>{t.linkedPassport}: <code className="break-all">{data.correction.correctionPassportId}</code> · {data.correction.correctionStatus}</p>
      <p>{data.correction.replacementTokenId ? `${t.replacement} #${data.correction.replacementTokenId}` : t.pendingReplacement}</p>
    </div> : data?.published && <>
      {!canWrite ? <p>{t.readOnly}</p> : <div className="space-y-3">
        <label className="block">{t.reason}<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3}
          disabled={disabled || busy} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={checked}
          disabled={disabled || busy} onChange={event => setChecked(event.target.checked)} /><span>{t.consent}</span></label>
        <Button type="button" onClick={() => void open()} disabled={!checked || reason.trim().length < 3 || disabled || busy}>{t.open}</Button>
      </div>}
    </>}
  </section>;
}
