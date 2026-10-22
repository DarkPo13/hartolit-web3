"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PublicConfirmation } from "@/components/public-snapshot/PublicSnapshotView";
import { useLocale, useT } from "@/lib/i18n/context";
import type { PublicationOverview } from "@/lib/publication/types";
import { PublicationPreparation } from "./PublicationPreparation";

function WalletLoading() {
  const t = useT().publisher;
  return <p role="status" className="text-sm">{t.loading}</p>;
}

const PublisherWallet = dynamic(() => import("./PublisherWallet").then(m => m.PublisherWallet), { ssr: false, loading: WalletLoading });

export function PublicationPanel({ passportId, confirmation, disabled }: {
  passportId: string; confirmation: PublicConfirmation; disabled: boolean;
}) {
  const t = useT().publisher;
  const { locale } = useLocale();
  const headingId = useId();
  const [data, setData] = useState<PublicationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"loadError" | "changed" | "actionError" | "saveUncertain" | null>(null);
  const request = useRef(0);
  const alive = useRef(true);
  const base = `/api/admin/passports/${encodeURIComponent(passportId)}/publication`;

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: PublicationOverview = await response.json();
      if (alive.current && id === request.current) { setData(result); setError(null); return result; }
    } catch { if (alive.current && id === request.current) { setData(null); setError("loadError"); } }
    finally { if (alive.current && id === request.current) setLoading(false); }
    return null;
  }, [base]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current += 1; };
  }, [load]);

  const current = data?.reservations.find(r => r.confirmationId === confirmation.id && r.status === "RESERVED" &&
    r.passportVersion === confirmation.preview.passportVersion && r.payloadHash === confirmation.preview.sha256);
  const blocked = data?.reservations.some(r => r.status !== "RESERVED" && r.status !== "CANCELLED");
  const cancelled = data?.reservations.some(r => r.confirmationId === confirmation.id && r.status === "CANCELLED");
  const publication = data?.reservations.find(r => r.confirmationId === confirmation.id && r.status !== "CANCELLED" &&
    r.passportVersion === confirmation.preview.passportVersion && r.payloadHash === confirmation.preview.sha256);

  async function reserve() {
    if (!data?.publisher.canProve || !data.publisher.walletAddress || busy || disabled || loading || cancelled) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        confirmationId: confirmation.id, passportVersion: confirmation.preview.passportVersion,
        expectedSha256: confirmation.preview.sha256, walletAddress: data.publisher.walletAddress,
      }) });
      if (!response.ok) throw new Error(String(response.status));
      if (alive.current) await load();
    } catch (cause) {
      if (alive.current) {
        // A lost response may follow a successful write; read status before offering a retry.
        const result = await load();
        if (alive.current && !result?.reservations.some(r => r.confirmationId === confirmation.id && r.status === "RESERVED")) {
          setError(cause instanceof Error && cause.message === "409" ? "changed" : "actionError");
        }
      }
    } finally { if (alive.current) setBusy(false); }
  }

  return <section aria-labelledby={headingId} className="mt-6 space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
    <div><h4 id={headingId} className="font-semibold text-ink">{t.title}</h4><p className="mt-2 text-sm text-ink-muted">{t.hint}</p></div>
    {loading && <p role="status" className="text-sm">{t.loading}</p>}
    {error && <p role="alert" className="text-sm text-danger">{t[error]}</p>}
    <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy || disabled}>{t.refresh}</Button>
    {data && <>
      {!data.publisher.configured ? <p className="text-sm text-ink-muted">{t.notConfigured}</p> : !data.publisher.canProve ? <p className="text-sm text-ink-muted">{t.otherPublisher}</p> : <>
        <div className="text-sm"><p className="font-medium">{t.allowedWallet}</p><code className="mt-1 block break-all">{data.publisher.walletAddress}</code></div>
        {cancelled ? <p role="alert" className="text-sm text-danger">{t.approvalChanged}</p> : blocked ? <p role="status" className="text-sm">{t.blocked}</p> : current?.walletVerifiedAt ? <div role="status" className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900"><p className="font-semibold">{t.verified}</p><p className="mt-1">{new Date(current.walletVerifiedAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}</p><p className="mt-2">{t.stillPrivate}</p></div> : current && data.publisher.walletAddress ? <PublisherWallet
          key={current.id} base={base} reservation={current} walletAddress={data.publisher.walletAddress}
          certificateId={confirmation.preview.snapshot.certificateId} disabled={disabled || busy || loading} onVerified={async uncertain => {
            const result = await load();
            if (alive.current && uncertain && !result?.reservations.find(r => r.id === current.id)?.walletVerifiedAt) setError("saveUncertain");
          }}
        /> : <Button type="button" onClick={() => void reserve()} loading={busy} disabled={disabled || busy || loading}>{t.reserve}</Button>}
      </>}
      {publication && <PublicationPreparation key={`${publication.id}:${confirmation.id}:${confirmation.preview.sha256}:${data.pinning.target?.configurationSha256}:${data.publisher.canProve}`} base={base}
        confirmation={confirmation} reservation={publication} data={data} disabled={disabled || busy || loading} reload={load} />}
    </>}
  </section>;
}
