import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

/** The home-screen app opens here: admins land in the console, everyone else on the workspace. */
export default async function StartPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  redirect(actor.role === "admin" ? "/admin" : "/");
}
