import "server-only";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";

/** Every admin page checks this itself: the shared layout is not re-rendered
 * on client navigation, so it cannot be the only gate.
 */
export async function requireAdmin() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "admin") redirect("/");
  if (!actor.twoFactorEnabled) redirect("/settings/security");
  return actor;
}
