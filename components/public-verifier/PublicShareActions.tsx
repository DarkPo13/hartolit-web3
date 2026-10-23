"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

/** Share, print and download for a VALID record. The download is the exact
 * verified canonical JSON, so its SHA-256 equals the on-chain hash shown above.
 */
export function PublicShareActions({ tokenId, url, qrDataUrl, canonicalJson }: { tokenId: string; url: string; qrDataUrl: string; canonicalJson: string }) {
  const t = useT().publicVerifier;
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied("done"); } catch { setCopied("failed"); }
  };
  const download = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([canonicalJson], { type: "application/json" }));
    link.download = `hartolit-passport-${tokenId}.json`;
    link.click();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  };
  const button = "rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-700 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-600";

  return <section aria-labelledby="public-share-title" className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
    <h2 id="public-share-title" className="font-serif text-2xl font-semibold text-ink">{t.shareTitle}</h2>
    <p className="mt-2 text-sm text-ink-muted">{t.shareDescription}</p>
    <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
      <img src={qrDataUrl} alt={t.qrAlt} width={240} height={240} className="h-48 w-48 shrink-0 rounded-lg border border-border bg-white sm:h-60 sm:w-60" />
      <div className="min-w-0 flex-1 space-y-3">
        <label className="block text-sm"><span className="text-ink-muted">{t.shareLink}</span>
          <input readOnly value={url} onFocus={event => event.currentTarget.select()} className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs" />
        </label>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" onClick={copy} className={button}>{t.copyLink}</button>
          <a href={qrDataUrl} download={`hartolit-passport-${tokenId}-qr.png`} className={button}>{t.downloadQr}</a>
          <button type="button" onClick={() => window.print()} className={button}>{t.print}</button>
          <button type="button" onClick={download} className={button}>{t.downloadJson}</button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-ink-muted print:hidden">{copied === "done" ? t.copied : copied === "failed" ? t.copyFailed : ""}</p>
        <p className="text-sm text-ink-muted">{t.downloadJsonHint}</p>
      </div>
    </div>
  </section>;
}
