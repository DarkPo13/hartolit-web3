"use client";

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Leaf, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";

export function ResponsibleTreatmentDialog({ passportId }: { passportId: string }) {
  const [open, setOpen] = useState(true);
  const t = useT().feedback;
  const returnTo = `/admin/passports/${encodeURIComponent(passportId)}/certificate`;

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><Button type="button" variant="outline" leadingIcon={<Leaf className="h-4 w-4" aria-hidden />}>{t.responsibility}</Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-brand-200 bg-surface p-6 shadow-deep sm:p-8">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Leaf className="h-7 w-7" aria-hidden /></div>
        <Dialog.Title className="pr-6 font-serif text-3xl font-semibold text-ink">{t.thankYou}</Dialog.Title>
        <Dialog.Description className="mt-4 text-base leading-relaxed text-ink-muted">{t.responsibilityMessage}</Dialog.Description>
        <p className="mt-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-relaxed text-brand-900">{t.soilReminder}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild><Link href={`/feedback?returnTo=${encodeURIComponent(returnTo)}`}><MessageSquare className="h-4 w-4" aria-hidden />{t.leaveFeedback}</Link></Button>
          <Dialog.Close asChild><Button type="button" variant="secondary">{t.viewCertificate}</Button></Dialog.Close>
        </div>
        <Dialog.Close asChild><button type="button" aria-label={t.close} className="absolute right-4 top-4 rounded-lg p-2 text-ink-muted hover:bg-surface-2"><X className="h-5 w-5" aria-hidden /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
