import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminShell } from "./AdminShell";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";
import { requireAdmin } from "./require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdmin();
  // Read on the server so a collapsed menu renders collapsed from the first paint.
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return <AdminShell user={{ name: actor.name, email: actor.email }} collapsed={collapsed}>{children}</AdminShell>;
}
