"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

type Item = { id: string; status: string; version: number; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null; farmerName: string; crop: string; reviewerName: string | null };

export function ReviewStatusPanel({ revision, onReopened }: { revision: number; onReopened: (id: string) => Promise<void> }) {
  const t = useT().review;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/passports/mine", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setItems((await response.json()).passports as Item[]);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, revision]);

  async function reopen(item: Item) {
    setBusyId(item.id);
    setError(false);
    try {
      const response = await fetch(`/api/passports/${encodeURIComponent(item.id)}/reopen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: item.version }) });
      if (!response.ok) throw new Error();
      await onReopened(item.id);
      await load();
    } catch { setError(true); }
    finally { setBusyId(null); }
  }

  const status: Record<string, string> = { SUBMITTED: t.submitted, APPROVED: t.approved, REJECTED: t.rejected, CORRECTION_REQUIRED: t.correctionRequired, PUBLISHING: t.publishing, PUBLISHED: t.published, FAILED_RETRYABLE: t.failed };
  return <section className="rounded-2xl border border-border bg-surface p-5 md:p-6" aria-labelledby="my-reviews-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="my-reviews-heading" className="text-xl font-semibold text-ink">{t.myPassports}</h2><p className="mt-1 text-sm text-ink-muted">{t.myPassportsHint}</p></div><button type="button" onClick={() => void load()} className="text-sm font-medium text-brand-700 underline">{t.refresh}</button></div>
    {loading ? <p role="status" className="mt-4 text-sm text-ink-muted">{t.loading}</p> : error ? <p role="alert" className="mt-4 text-sm text-danger">{t.loadError}</p> : !items.length ? <p className="mt-4 text-sm text-ink-muted">{t.noSubmissions}</p> : <ul className="mt-4 divide-y divide-border">
      {items.map((item) => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
        <div><p className="font-medium text-ink">{item.farmerName || t.untitled} · {item.crop || "—"}</p><p className="text-ink-muted">{status[item.status] ?? item.status}{item.reviewerName ? ` · ${item.reviewerName}` : ""}</p>{item.reviewNote && <p className="mt-2 max-w-xl whitespace-pre-wrap text-ink">{item.reviewNote}</p>}</div>
        {(item.status === "REJECTED" || item.status === "CORRECTION_REQUIRED") && <button type="button" onClick={() => void reopen(item)} disabled={busyId !== null} className="font-medium text-brand-700 underline disabled:opacity-50">{busyId === item.id ? t.reopening : t.reopen}</button>}
      </li>)}
    </ul>}
  </section>;
}
