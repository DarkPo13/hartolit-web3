import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { HelpDocument } from "@/components/help/HelpDocument";
import { operatorHelp } from "@/lib/help/operator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operator guide", robots: { index: false, follow: false } };

export default async function OperatorHelpPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "admin" && !actor.twoFactorEnabled) redirect("/settings/security");
  return <HelpDocument docs={operatorHelp} kind="operator" isAdmin={actor.role === "admin"} />;
}
