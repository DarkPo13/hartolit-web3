import { redirect } from "next/navigation";
import { PassportHome } from "./PassportHome";
import { getActor } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "admin" && !actor.twoFactorEnabled) redirect("/settings/security");
  return <PassportHome actorId={actor.id} isAdmin={actor.role === "admin"} />;
}
