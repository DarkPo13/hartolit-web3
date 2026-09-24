import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { SecurityForm } from "./SecurityForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account security", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <SecurityForm enabled={actor.twoFactorEnabled} isAdmin={actor.role === "admin"} />;
}
