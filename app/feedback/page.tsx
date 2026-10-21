import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "admin" && !actor.twoFactorEnabled) redirect("/settings/security");
  const { returnTo } = await searchParams;
  const back = typeof returnTo === "string" && /^\/admin\/passports\/[0-9a-f-]{36}\/certificate$/.test(returnTo) && actor.role === "admin" ? returnTo : "/";
  return <FeedbackForm back={back} />;
}
