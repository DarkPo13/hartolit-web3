"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Smartphone, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { DiiaSignerRole, DiiaSignResponse, DiiaVerifyResponse } from "@/types/diia";

interface DiiaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: DiiaSignerRole;
  documentFilename: string;
  documentSha256: string;
  signerName: string;
  signerEdrpou?: string;
  onSigned: (signature: NonNullable<DiiaVerifyResponse["signature"]>) => void;
}

export function DiiaModal({
  open,
  onOpenChange,
  role,
  documentFilename,
  documentSha256,
  signerName,
  signerEdrpou,
  onSigned,
}: DiiaModalProps) {
  const [phase, setPhase] = React.useState<"init" | "awaiting" | "signed" | "error">("init");
  const [session, setSession] = React.useState<DiiaSignResponse | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const t = useT();

  React.useEffect(() => {
    if (!open) {
      setPhase("init");
      setSession(null);
      setErrorMsg(null);
    }
  }, [open]);

  async function startSigning() {
    try {
      setPhase("awaiting");
      setErrorMsg(null);

      const initRes = await fetch("/api/diia/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          documentSha256,
          documentFilename,
          signerName,
          signerEdrpou,
        }),
      });
      if (!initRes.ok) throw new Error(await initRes.text());
      const sess = (await initRes.json()) as DiiaSignResponse;
      setSession(sess);

      const start = Date.now();
      const timeoutMs = 60_000;
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 1500));
        const verifyRes = await fetch("/api/diia/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sess.sessionId }),
        });
        if (!verifyRes.ok) continue;
        const v = (await verifyRes.json()) as DiiaVerifyResponse;
        if (v.status === "signed" && v.signature) {
          setPhase("signed");
          onSigned(v.signature);
          setTimeout(() => onOpenChange(false), 1200);
          return;
        }
        if (v.status === "rejected" || v.status === "expired") {
          throw new Error(`Підпис ${v.status === "rejected" ? "відхилено" : "протерміновано"}`);
        }
      }
      throw new Error("Час очікування вичерпано");
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "Невідома помилка");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl bg-surface p-6 shadow-deep border border-border",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">
                {t.diia.modalTitle}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-ink-muted mt-1">
                {role === "pilot" ? t.diia.pilotModalDesc : t.diia.supplierModalDesc}
              </Dialog.Description>
            </div>
            <Dialog.Close className="text-ink-subtle hover:text-ink transition-colors">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-surface-2/40 p-3 text-xs">
            <p className="text-ink-muted">{t.diia.docLabel}</p>
            <p className="font-medium text-ink truncate">{documentFilename}</p>
            <p className="hash-mono mt-1.5 text-ink-subtle truncate">
              SHA-256: {documentSha256}
            </p>
          </div>

          <div className="mt-5">
            {phase === "init" && (
              <div className="space-y-4">
                <p className="text-sm text-ink-muted">{t.diia.initText}</p>
                <Button
                  onClick={startSigning}
                  size="lg"
                  className="w-full"
                  leadingIcon={<Smartphone className="h-4 w-4" />}
                >
                  {t.diia.startButton}
                </Button>
              </div>
            )}

            {phase === "awaiting" && (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="relative">
                  <div className="h-20 w-20 rounded-full border-4 border-brand-100" />
                  <Loader2 className="absolute inset-0 m-auto h-10 w-10 text-brand-600 animate-spin" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-ink">{t.diia.awaitingTitle}</p>
                  <p className="text-xs text-ink-muted mt-1">{t.diia.awaitingDesc}</p>
                </div>
                {session && (
                  <code className="hash-mono text-xs text-ink-subtle">
                    {t.diia.sessionLabel} {session.sessionId.slice(0, 24)}…
                  </code>
                )}
              </div>
            )}

            {phase === "signed" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="h-12 w-12 text-brand-600" />
                <p className="font-medium text-ink">{t.diia.signedText}</p>
              </div>
            )}

            {phase === "error" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <AlertTriangle className="h-5 w-5 text-rose-700 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-800">{errorMsg ?? "Помилка"}</p>
                </div>
                <Button onClick={startSigning} variant="secondary" size="md" className="w-full">
                  {t.diia.retryButton}
                </Button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
