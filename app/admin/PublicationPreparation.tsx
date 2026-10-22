"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PublicSnapshotView, type PublicConfirmation } from "@/components/public-snapshot/PublicSnapshotView";
import { useT } from "@/lib/i18n/context";
import type { PublicationOverview, PublicationReservation } from "@/lib/publication/types";

export function PublicationPreparation({ base, confirmation, reservation, data, disabled, reload }: {
  base: string; confirmation: PublicConfirmation; reservation: PublicationReservation; data: PublicationOverview;
  disabled: boolean; reload: () => Promise<PublicationOverview | null>;
}) {
  const t = useT().publicationPreparation;
  const heading = useId();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"changed" | "accessDenied" | "uncertain" | null>(null);
  const running = useRef(false), alive = useRef(true), requestId = useRef<string | null>(null);
  const target = data.pinning.target;
  const history = data.pinning.attempts.filter(row => row.publicationId === reservation.id);
  const active = history.find(row => row.status !== "CANCELLED");
  const matches = !active || (active.confirmationId === confirmation.id && active.passportVersion === confirmation.preview.passportVersion &&
    active.payloadHash === confirmation.preview.sha256 && !!target && active.providerKey === target.key &&
    active.providerConfigHash === target.configurationSha256 && active.storageProfile === target.storageProfile);
  const canPrepare = data.publisher.canProve && !!reservation.walletVerifiedAt && reservation.status === "RESERVED";

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { setChecked(false); requestId.current = null; setError(null); }, [active?.id, active?.status]);

  async function mutate(cancel = false) {
    if (disabled || running.current || !canPrepare || (cancel ? active?.status !== "PREPARED" : !checked || !!active || !target)) return;
    const current = () => alive.current;
    running.current = true; setBusy(true); setChecked(false); setError(null);
    if (!cancel) requestId.current ??= crypto.randomUUID();
    const operationRequestId = requestId.current;
    try {
      const response = await fetch(`${base}/pin-attempts`, {
        method: cancel ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cancel ? { publicationId: reservation.id, attemptId: active!.id } : {
          publicationId: reservation.id, requestId: operationRequestId, confirmationId: confirmation.id,
          passportVersion: confirmation.preview.passportVersion, expectedSha256: confirmation.preview.sha256,
          expectedTargetSha256: target!.configurationSha256, acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT",
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      if (current()) await reload();
    } catch (cause) {
      if (!current()) return;
      // Read status even after a failed/lost response; preparation may already exist.
      const result = await reload();
      if (!current()) return;
      const found = result?.pinning.attempts.find(row => row.publicationId === reservation.id &&
        (cancel ? row.id === active?.id && row.status === "CANCELLED" : row.requestId === operationRequestId));
      if (!found) setError(cause instanceof Error && ["401", "403"].includes(cause.message) ? "accessDenied" :
        cause instanceof Error && ["409", "503"].includes(cause.message) ? "changed" : "uncertain");
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }

  const awaiting = active?.status === "DISPATCHING" || active?.status === "UNKNOWN";
  return <section aria-labelledby={heading} className="space-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
    <h5 id={heading} className="font-semibold">{t.title}</h5>
    <p className="text-ink-muted">{t.hint}</p>
    {error && <p role="alert" className="text-danger">{t[error]}</p>}
    {busy && <p role="status">{t.saving}</p>}
    {!target && <p role="status">{t.notConfigured}</p>}
    {target && <div className="space-y-1"><p>{t.target}: <strong className="break-all">{target.key}</strong></p>
      <details><summary className="cursor-pointer font-medium text-brand-700">{t.binding}</summary>
        <dl className="mt-2 space-y-2"><div><dt>{t.profile}</dt><dd className="break-all font-mono text-xs">{target.storageProfile}</dd></div>
          <div><dt>{t.targetHash}</dt><dd className="break-all font-mono text-xs">{target.configurationSha256}</dd></div>
          <div><dt>{t.payloadHash}</dt><dd className="break-all font-mono text-xs">{confirmation.preview.sha256}</dd></div></dl>
      </details></div>}
    {!matches && <p role="alert" className="text-danger">{t.changed}</p>}
    {active?.status === "PREPARED" && <><p role="status" className="font-medium">{t.prepared}</p>
      <p>{t.noDispatch}</p>{canPrepare && <Button type="button" variant="outline" size="sm" onClick={() => void mutate(true)} disabled={disabled || busy}>{t.cancel}</Button>}</>}
    {awaiting && <p role="status">{t.unknown}</p>}
    {active?.status === "VERIFIED" && <p role="status">{t.pinned}</p>}
    {!active && history.some(row => row.status === "CANCELLED") && <p role="status">{t.cancelled}</p>}
    {!data.publisher.canProve && <p>{t.readOnly}</p>}
    {!active && data.publisher.canProve && !reservation.walletVerifiedAt && <p>{t.needsProof}</p>}
    {!active && canPrepare && target && <div className="space-y-3">
      <details><summary className="cursor-pointer font-medium text-brand-700">{t.review}</summary><PublicSnapshotView preview={confirmation.preview} confirmed /></details>
      <p>{t.publicNotice}</p>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-brand-600" checked={checked}
        disabled={disabled || busy} onChange={event => setChecked(event.target.checked)} /><span>{t.consent}</span></label>
      <Button type="button" onClick={() => void mutate()} disabled={!checked || disabled || busy}>{t.prepare}</Button>
    </div>}
  </section>;
}
