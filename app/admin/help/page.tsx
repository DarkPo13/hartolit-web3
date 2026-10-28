import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { HelpDocument } from "@/components/help/HelpDocument";
import { adminHelp } from "@/lib/help/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin guide", robots: { index: false, follow: false } };

export default async function AdminHelpPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "admin") redirect("/");
  if (!actor.twoFactorEnabled) redirect("/settings/security");
  return <HelpDocument docs={adminHelp} kind="admin" isAdmin />;
}
