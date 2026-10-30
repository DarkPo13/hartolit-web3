"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useT } from "@/lib/i18n/context";

export function PageHeader({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      {children}
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
      {hint && <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">{hint}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

export function Panel({ title, action, flush, level = 2, children, className = "" }: { title?: ReactNode; action?: ReactNode; flush?: boolean; level?: 2 | 3; children: ReactNode; className?: string }) {
  const id = useId();
  const Heading = level === 3 ? "h3" : "h2";
  return <section aria-labelledby={title ? id : undefined} className={`overflow-hidden rounded-2xl border border-border bg-surface shadow-soft ${className}`}>
    {(title || action) && <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">{title && <Heading id={id} className="text-base font-semibold text-ink">{title}</Heading>}{action}</div>}
    <div className={flush ? "" : `px-5 pb-5 ${title || action ? "" : "pt-5"}`}>{children}</div>
  </section>;
}

const tones: Record<string, "info" | "success" | "warning" | "danger" | "brand" | "neutral"> = {
  SUBMITTED: "info", APPROVED: "success", CORRECTION_REQUIRED: "warning", REJECTED: "danger", PUBLISHING: "brand", PUBLISHED: "brand", FAILED_RETRYABLE: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={tones[status] ?? "neutral"}>{t.codes.passportStatus[status] ?? status}</Badge>;
}

export const buttonClass = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50",
};

/** A side panel on a native modal dialog: focus stays inside, Escape and a
 * click outside close it.
 */
export function Drawer({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT().management;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="ml-auto mr-0 mt-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto bg-canvas p-0 text-ink shadow-deep backdrop:bg-ink/40">
    {open && <div className="relative p-5 sm:p-6">
      <button type="button" onClick={onClose} aria-label={t.close} className="absolute right-3 top-3 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
      {children}
    </div>}
  </dialog>;
}
