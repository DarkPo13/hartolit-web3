import { OverviewView } from "./OverviewView";
import { requireAdmin } from "./require-admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const actor = await requireAdmin();
  return <OverviewView actorId={actor.id} />;
}
