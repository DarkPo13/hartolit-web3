"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DiiaModal } from "./DiiaModal";
import { DiiaSigPreview } from "./DiiaSigPreview";
import type { DiiaSignerRole } from "@/types/diia";
import type { DiiaSignatureRef } from "@/types/passport";

interface DiiaBlockProps {
  role: DiiaSignerRole;
  documentFilename: string;
  documentSha256: string;
  signerName: string;
  signerEdrpou?: string;
  signature: DiiaSignatureRef | null | undefined;
  onSigned: (signature: DiiaSignatureRef) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function DiiaBlock(props: DiiaBlockProps) {
  const [open, setOpen] = useState(false);
  const { signature, disabled, disabledReason } = props;

  if (signature) {
    return <DiiaSigPreview signature={signature} />;
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/40 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-ink-subtle flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">
            Очікується КЕП-підпис
            {props.role === "pilot" ? " пілота" : " постачальника"}
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            Підпишіть документ у застосунку Дія (qualified electronic signature)
          </p>
          {disabled && disabledReason && (
            <p className="text-xs text-amber-700 mt-2">{disabledReason}</p>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
          leadingIcon={<ShieldCheck className="h-4 w-4" />}
        >
          Підписати в Дії
        </Button>
      </div>
      <DiiaModal
        open={open}
        onOpenChange={setOpen}
        role={props.role}
        documentFilename={props.documentFilename}
        documentSha256={props.documentSha256}
        signerName={props.signerName}
        signerEdrpou={props.signerEdrpou}
        onSigned={(sig) =>
          props.onSigned({
            keyId: sig.keyId,
            signerName: sig.signerName,
            signerEdrpou: sig.signerEdrpou,
            timestamp: sig.timestamp,
            sha256: sig.sha256,
            certSerial: sig.certSerial,
          })
        }
      />
    </div>
  );
}
