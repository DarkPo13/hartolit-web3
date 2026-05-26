"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Locale, Translations } from "./types";
import { en } from "./translations/en";
import { uk } from "./translations/uk";

const STORAGE_KEY = "hartolit-locale";
const DEFAULT_LOCALE: Locale = "uk";

const dicts: Record<Locale, Translations> = { en, uk };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translations;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: uk,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (stored === "en" || stored === "uk") setLocaleState(stored);
    } catch {
      // localStorage unavailable (SSR guard)
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: dicts[locale] }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT(): Translations {
  return useContext(LocaleContext).t;
}
