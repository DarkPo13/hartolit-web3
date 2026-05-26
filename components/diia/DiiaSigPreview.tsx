"use client";

import { CheckCircle2, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { shortHash, formatDateTime } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { DiiaSignatureRef } from "@/types/passport";

export function DiiaSigPreview({ signature }: { signature: DiiaSignatureRef }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-brand-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink">{t.diia.sigTitle}</span>
            <Badge tone="success">Verified</Badge>
            <Badge tone="info" className="hash-mono">
              <KeyRound className="h-3 w-3" /> {signature.keyId}
            </Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-ink-subtle">{t.diia.signerLabel}</span>{" "}
              <span className="text-ink">{signature.signerName}</span>
            </div>
            {signature.signerEdrpou && (
              <div>
                <span className="text-ink-subtle">{t.diia.edrpouLabel}</span>{" "}
                <span className="text-ink font-mono">{signature.signerEdrpou}</span>
              </div>
            )}
            <div>
              <span className="text-ink-subtle">{t.diia.timeLabel}</span>{" "}
              <span className="text-ink">{formatDateTime(signature.timestamp)}</span>
            </div>
            {signature.certSerial && (
              <div>
                <span className="text-ink-subtle">{t.diia.certLabel}</span>{" "}
                <span className="text-ink font-mono">{signature.certSerial}</span>
              </div>
            )}
          </div>
          <div className="hash-mono text-xs text-ink-subtle break-all">
            sig SHA-256: {shortHash(signature.sha256, 10, 10)}
          </div>
        </div>
      </div>
    </div>
  );
}
