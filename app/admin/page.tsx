import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { AdminConsole } from "./AdminConsole";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "admin") redirect("/");
  if (!actor.twoFactorEnabled) redirect("/settings/security");

  return <AdminConsole actorId={actor.id} />;
}
