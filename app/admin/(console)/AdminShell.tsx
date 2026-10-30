"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ClipboardCheck, House, LayoutDashboard, LogOut, Map as MapIcon, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, ScrollText, ShieldCheck, Sprout, Stamp, UserCog, Users, X, type LucideIcon } from "lucide-react";
import { LocaleToggle } from "@/components/ui/LocaleToggle";
import { useT } from "@/lib/i18n/context";
import { useSignOut } from "@/lib/use-sign-out";
import { cn } from "@/lib/utils";
import { AdminOverviewProvider, useAdminOverview } from "./admin-data";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

type Item = { href: string; key: keyof ReturnType<typeof useT>["adminShell"]["items"]; icon: LucideIcon };
const groups: { key: keyof ReturnType<typeof useT>["adminShell"]["groups"]; items: Item[] }[] = [
  { key: "work", items: [{ href: "/admin", key: "overview", icon: LayoutDashboard }, { href: "/admin/passports", key: "queue", icon: ClipboardCheck }] },
  { key: "registry", items: [{ href: "/admin/farmers", key: "farmers", icon: Sprout }, { href: "/admin/fields", key: "fields", icon: MapIcon }, { href: "/admin/publications", key: "publications", icon: Stamp }] },
  { key: "people", items: [{ href: "/admin/users", key: "users", icon: Users }] },
  { key: "logs", items: [{ href: "/admin/audit", key: "audit", icon: ScrollText }, { href: "/admin/admin-actions", key: "adminActions", icon: UserCog }] },
  { key: "support", items: [{ href: "/admin/feedback", key: "feedback", icon: MessageSquare }, { href: "/admin/help", key: "help", icon: BookOpen }] },
];

const isActive = (pathname: string, href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function AdminShell({ user, collapsed, children }: { user: { name: string; email: string }; collapsed: boolean; children: ReactNode }) {
  return <AdminOverviewProvider><Shell user={user} initiallyCollapsed={collapsed}>{children}</Shell></AdminOverviewProvider>;
}

function Shell({ user, initiallyCollapsed, children }: { user: { name: string; email: string }; initiallyCollapsed: boolean; children: ReactNode }) {
  const s = useT().adminShell;
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/admin; max-age=31536000; samesite=lax`;
  };
  const waiting = useAdminOverview().overview?.counts.SUBMITTED ?? 0;
  useEffect(() => { menu.current?.close(); }, [pathname]);

  return <div className={cn("min-h-dvh lg:grid", collapsed ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]")}>
    <a href="#admin-main" className="sr-only rounded-lg bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lifted focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">{s.skip}</a>
    <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <Sidebar idPrefix="side" collapsed={collapsed} />
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-canvas/95 px-4 backdrop-blur sm:px-6 lg:px-10">
        <div className="lg:hidden"><Brand /></div>
        <button type="button" onClick={toggle} aria-label={collapsed ? s.expandMenu : s.collapseMenu} title={collapsed ? s.expandMenu : s.collapseMenu}
          className="-ml-2 hidden rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink lg:inline-flex">
          {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleToggle className="hidden sm:flex" />
          <button type="button" onClick={() => menu.current?.showModal()} aria-haspopup="dialog" aria-expanded={open} aria-controls="admin-menu"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink lg:hidden">
            <Menu className="h-4 w-4" aria-hidden />{s.menu}
            {waiting > 0 && <><span className="rounded-full bg-brand-700 px-1.5 text-xs text-white" aria-hidden>{waiting}</span><span className="sr-only">{s.waitingCount.replace("{n}", String(waiting))}</span></>}
          </button>
          <AccountMenu user={user} />
        </div>
      </header>
      <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
    <dialog id="admin-menu" ref={menu} aria-label={s.sections} onClose={() => setOpen(false)} onToggle={event => setOpen(event.currentTarget.open)}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      className="m-0 h-dvh max-h-dvh w-[min(18rem,85vw)] max-w-none bg-surface p-0 text-ink shadow-deep backdrop:bg-ink/40 lg:hidden">
      <div className="flex h-full flex-col">
        <button type="button" onClick={() => menu.current?.close()} aria-label={s.closeMenu} className="absolute right-2 top-3 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
        <Sidebar idPrefix="drawer" />
      </div>
    </dialog>
  </div>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  const s = useT().adminShell;
  return <Link href="/admin" className="flex min-w-0 items-center gap-2.5 rounded-lg">
    <Image src="/logo.png" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
    <span className={cn("min-w-0 leading-tight", compact && "sr-only")}><span className="block text-sm font-semibold text-ink">Hartolit</span><span className="block truncate text-xs text-ink-muted">{s.console}</span></span>
  </Link>;
}

/** Collapsed, the menu keeps only icons: the names stay for screen readers and
 * appear beside an icon on hover or keyboard focus. */
function Sidebar({ idPrefix, collapsed = false }: { idPrefix: string; collapsed?: boolean }) {
  const s = useT().adminShell;
  const pathname = usePathname();
  const waiting = useAdminOverview().overview?.counts.SUBMITTED ?? 0;

  return <>
    <div className={cn("pb-2 pt-4", collapsed ? "flex justify-center px-2" : "px-4")}><Brand compact={collapsed} /></div>
    <nav aria-label={s.sections} className={cn("flex-1 px-3 py-2", collapsed ? "overflow-visible" : "overflow-y-auto")}>
      {groups.map(group => <div key={group.key} className={cn("mt-4 first:mt-1", collapsed && "border-t border-border pt-3 first:border-t-0 first:pt-0")}>
        <p id={`${idPrefix}-${group.key}`} className={cn("px-2 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-subtle", collapsed && "sr-only")}>{s.groups[group.key]}</p>
        <ul aria-labelledby={`${idPrefix}-${group.key}`} className="mt-1 space-y-0.5">
          {group.items.map(item => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined}
                className={cn("group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors", collapsed && "justify-center", active ? "bg-brand-50 font-semibold text-brand-800" : "text-ink-muted hover:bg-surface-2 hover:text-ink")}>
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand-700" : "text-ink-subtle")} aria-hidden />
                {collapsed
                  ? <><span className="sr-only">{s.items[item.key]}</span><span aria-hidden className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-canvas shadow-lifted group-hover:block group-focus-visible:block">{s.items[item.key]}</span></>
                  : <span className="flex-1">{s.items[item.key]}</span>}
                {item.key === "queue" && waiting > 0 && <><span className={cn("rounded-full bg-brand-700 text-xs font-semibold text-white", collapsed ? "absolute right-0.5 top-0.5 min-w-4 px-1 text-center text-[0.65rem] leading-4" : "px-2 py-0.5")} aria-hidden>{waiting}</span><span className="sr-only">{s.waitingCount.replace("{n}", String(waiting))}</span></>}
              </Link>
            </li>;
          })}
        </ul>
      </div>)}
    </nav>
  </>;
}

/** The signed-in admin at the top right: a disclosure with the email, the
 * operator workspace, account security, the language on phones and sign-out.
 */
function AccountMenu({ user }: { user: { name: string; email: string } }) {
  const t = useT();
  const s = t.adminShell;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { signOut, pending, failed } = useSignOut();
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface-2";

  return <div ref={box} className="relative">
    <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="admin-account"
      className="flex items-center gap-2 rounded-full border border-border bg-surface p-1 text-sm font-medium text-ink hover:bg-surface-2 sm:pr-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white" aria-hidden>{initials}</span>
      <span className="sr-only sm:not-sr-only sm:max-w-40 sm:truncate">{user.name || user.email}</span>
      <ChevronDown className={cn("hidden h-4 w-4 text-ink-subtle transition-transform sm:block", open && "rotate-180")} aria-hidden />
    </button>
    <div id="admin-account" hidden={!open} className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-deep">
      <div className="border-b border-border px-3 pb-3 pt-2">
        <p className="text-xs text-ink-subtle">{s.signedInAs}</p>
        <p className="truncate font-medium text-ink">{user.name}</p>
        <p className="break-all text-xs text-ink-muted">{user.email}</p>
      </div>
      <ul className="space-y-0.5 py-2">
        <li><Link href="/" className={item}><House className="h-4 w-4 text-ink-subtle" aria-hidden />{s.operatorView}</Link></li>
        <li><Link href="/settings/security" className={item}><ShieldCheck className="h-4 w-4 text-ink-subtle" aria-hidden />{s.security}</Link></li>
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border px-1 pt-2">
        <LocaleToggle className="sm:hidden" />
        <button type="button" onClick={() => void signOut()} disabled={pending} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"><LogOut className="h-4 w-4" aria-hidden />{t.account.signOut}</button>
      </div>
      {failed && <p role="alert" className="px-3 pb-2 text-xs text-danger">{t.account.signOutError}</p>}
    </div>
  </div>;
}
