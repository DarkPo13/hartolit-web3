import type { Metadata } from "next";
import { AdminShell } from "./AdminShell";
import { requireAdmin } from "./require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdmin();
  return <AdminShell user={{ name: actor.name, email: actor.email }}>{children}</AdminShell>;
}
