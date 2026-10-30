"use client";

import { useLocale } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

/** UK/EN switch. Each button exposes whether its language is active. */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div className={cn("flex items-center rounded-lg border border-border bg-surface-2/60 p-0.5 text-xs font-medium", className)}>
      {(["uk", "en"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded-md px-2.5 py-1 transition-colors",
            locale === l
              ? "bg-brand-700 text-white shadow-soft"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
