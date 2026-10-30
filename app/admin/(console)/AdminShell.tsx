"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ClipboardCheck, House, LayoutDashboard, LogOut, Map as MapIcon, Menu, MessageSquare, ScrollText, ShieldCheck, Sprout, Stamp, UserCog, Users, X, type LucideIcon } from "lucide-react";
import { LocaleToggle } from "@/components/ui/LocaleToggle";
import { useT } from "@/lib/i18n/context";
import { useSignOut } from "@/lib/use-sign-out";
import { cn } from "@/lib/utils";
import { AdminOverviewProvider, useAdminOverview } from "./admin-data";

type Item = { href: string; key: keyof ReturnType<typeof useT>["adminShell"]["items"]; icon: LucideIcon };
const groups: { key: keyof ReturnType<typeof useT>["adminShell"]["groups"]; items: Item[] }[] = [
  { key: "work", items: [{ href: "/admin", key: "overview", icon: LayoutDashboard }, { href: "/admin/passports", key: "queue", icon: ClipboardCheck }] },
  { key: "registry", items: [{ href: "/admin/farmers", key: "farmers", icon: Sprout }, { href: "/admin/fields", key: "fields", icon: MapIcon }, { href: "/admin/publications", key: "publications", icon: Stamp }] },
  { key: "people", items: [{ href: "/admin/users", key: "users", icon: Users }] },
  { key: "logs", items: [{ href: "/admin/audit", key: "audit", icon: ScrollText }, { href: "/admin/admin-actions", key: "adminActions", icon: UserCog }] },
  { key: "support", items: [{ href: "/admin/feedback", key: "feedback", icon: MessageSquare }, { href: "/admin/help", key: "help", icon: BookOpen }] },
];

const isActive = (pathname: string, href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function AdminShell({ user, children }: { user: { name: string; email: string }; children: ReactNode }) {
  return <AdminOverviewProvider><Shell user={user}>{children}</Shell></AdminOverviewProvider>;
}

function Shell({ user, children }: { user: { name: string; email: string }; children: ReactNode }) {
  const s = useT().adminShell;
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const waiting = useAdminOverview().overview?.counts.SUBMITTED ?? 0;
  useEffect(() => { menu.current?.close(); }, [pathname]);

  return <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
    <a href="#admin-main" className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lifted focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">{s.skip}</a>
    <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <Sidebar user={user} idPrefix="side" />
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-canvas/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand />
        <button type="button" onClick={() => menu.current?.showModal()} aria-haspopup="dialog" aria-expanded={open} aria-controls="admin-menu"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink">
          <Menu className="h-4 w-4" aria-hidden />{s.menu}
          {waiting > 0 && <><span className="rounded-full bg-brand-700 px-1.5 text-xs text-white" aria-hidden>{waiting}</span><span className="sr-only">{s.waitingCount.replace("{n}", String(waiting))}</span></>}
        </button>
      </header>
      <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
    <dialog id="admin-menu" ref={menu} aria-label={s.sections} onClose={() => setOpen(false)} onToggle={event => setOpen(event.currentTarget.open)}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      className="m-0 h-dvh max-h-dvh w-[min(18rem,85vw)] max-w-none bg-surface p-0 text-ink shadow-deep backdrop:bg-ink/40 lg:hidden">
      <div className="flex h-full flex-col">
        <button type="button" onClick={() => menu.current?.close()} aria-label={s.closeMenu} className="absolute right-2 top-3 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
        <Sidebar user={user} idPrefix="drawer" />
      </div>
    </dialog>
  </div>;
}

function Brand() {
  const s = useT().adminShell;
  return <Link href="/admin" className="flex min-w-0 items-center gap-2.5 rounded-lg">
    <Image src="/logo.png" alt="" width={32} height={32} className="rounded-lg" />
    <span className="min-w-0 leading-tight"><span className="block text-sm font-semibold text-ink">Hartolit</span><span className="block truncate text-xs text-ink-muted">{s.console}</span></span>
  </Link>;
}

function Sidebar({ user, idPrefix }: { user: { name: string; email: string }; idPrefix: string }) {
  const t = useT();
  const s = t.adminShell;
  const pathname = usePathname();
  const waiting = useAdminOverview().overview?.counts.SUBMITTED ?? 0;
  const { signOut, pending, failed } = useSignOut();

  return <>
    <div className="px-4 pb-2 pt-4"><Brand /></div>
    <nav aria-label={s.sections} className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map(group => <div key={group.key} className="mt-4 first:mt-1">
        <p id={`${idPrefix}-${group.key}`} className="px-2 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-subtle">{s.groups[group.key]}</p>
        <ul aria-labelledby={`${idPrefix}-${group.key}`} className="mt-1 space-y-0.5">
          {group.items.map(item => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors", active ? "bg-brand-50 font-semibold text-brand-800" : "text-ink-muted hover:bg-surface-2 hover:text-ink")}>
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand-700" : "text-ink-subtle")} aria-hidden />
                <span className="flex-1">{s.items[item.key]}</span>
                {item.key === "queue" && waiting > 0 && <><span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white" aria-hidden>{waiting}</span><span className="sr-only">{s.waitingCount.replace("{n}", String(waiting))}</span></>}
              </Link>
            </li>;
          })}
        </ul>
      </div>)}
    </nav>
    <div className="space-y-3 border-t border-border p-4 text-sm">
      <div className="min-w-0">
        <p className="text-xs text-ink-subtle">{s.signedInAs}</p>
        <p className="truncate font-medium text-ink">{user.name}</p>
        <p className="truncate text-xs text-ink-muted" title={user.email}>{user.email}</p>
      </div>
      <ul className="space-y-0.5">
        <li><Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"><House className="h-4 w-4 text-ink-subtle" aria-hidden />{s.operatorView}</Link></li>
        <li><Link href="/settings/security" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"><ShieldCheck className="h-4 w-4 text-ink-subtle" aria-hidden />{s.security}</Link></li>
      </ul>
      <div className="flex items-center justify-between gap-2">
        <LocaleToggle />
        <button type="button" onClick={() => void signOut()} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"><LogOut className="h-4 w-4" aria-hidden />{t.account.signOut}</button>
      </div>
      {failed && <p role="alert" className="text-xs text-danger">{t.account.signOutError}</p>}
    </div>
  </>;
}
