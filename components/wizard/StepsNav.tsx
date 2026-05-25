"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWizardStore, type WizardStep } from "@/lib/store";

const STEPS: Array<{ id: WizardStep; title: string; subtitle: string }> = [
  { id: 1, title: "Дані обробки", subtitle: "Поле, дрон, метео, хімія" },
  { id: 2, title: "Блокчейн", subtitle: "IPFS + on-chain mint" },
  { id: 3, title: "Сертифікат", subtitle: "NFT-сертифікат + QR" },
];

export function StepsNav() {
  const step = useWizardStore((s) => s.step);
  const setStep = useWizardStore((s) => s.setStep);

  return (
    <nav aria-label="Прогрес створення паспорта" className="w-full">
      <ol className="flex items-center gap-2 md:gap-4">
        {STEPS.map((s, i) => {
          const isDone = step > s.id;
          const isActive = step === s.id;
          const isFuture = step < s.id;
          const canNavigate = isDone;

          return (
            <li key={s.id} className="flex flex-1 items-center gap-2 md:gap-4">
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => canNavigate && setStep(s.id)}
                className={cn(
                  "group flex flex-1 items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  isActive && "border-brand-500 bg-brand-50/50 shadow-soft",
                  isDone && "border-brand-200 bg-brand-50/30 cursor-pointer hover:bg-brand-50",
                  isFuture && "border-border bg-surface-2/50 cursor-not-allowed",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold transition-colors",
                    isActive && "bg-brand-600 text-white shadow-soft",
                    isDone && "bg-brand-600 text-white",
                    isFuture && "bg-surface-2 text-ink-subtle border border-border",
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" /> : s.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm font-medium truncate",
                      isActive ? "text-brand-900" : isDone ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="hidden md:block text-xs text-ink-subtle truncate">
                    {s.subtitle}
                  </span>
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    "hidden md:block h-px flex-shrink-0 w-8 transition-colors",
                    step > s.id ? "bg-brand-500" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
