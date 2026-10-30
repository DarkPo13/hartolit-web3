"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type Person = { id: string; name: string; email: string };
export type AdminOverview = {
  counts: Record<string, number>;
  activity: { id: string; passportId: string | null; action: string; createdAt: string }[];
  reviewers: Person[];
};

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

const OverviewContext = createContext<{ overview: AdminOverview | null; failed: boolean; refresh: () => void }>({ overview: null, failed: false, refresh: () => {} });

/** Status counts, recent activity and eligible reviewers, shared by the menu
 * badge and the pages. Reloaded on every navigation and after each action.
 */
export function AdminOverviewProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void getJson<AdminOverview>("/api/admin/overview", controller.signal)
      .then(result => { setOverview(result); setFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [pathname, revision]);
  return <OverviewContext.Provider value={{ overview, failed, refresh }}>{children}</OverviewContext.Provider>;
}

export const useAdminOverview = () => useContext(OverviewContext);

export type QueueItem = {
  id: string; status: string; version: number; submittedAt: string | null;
  farmer: { legalName: string | null }; field: { crop: string | null }; owner: { name: string; email: string }; reviewer: { id: string; name: string } | null;
  marks: { issuedTokenId: string | null; correctsTokenId: string | null; correctionOpened: boolean };
};

export const formatDate = (value: string | null, locale: string) => value ? new Date(value).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
