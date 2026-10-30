import { requireAdmin } from "../require-admin";
import { QueueView } from "./QueueView";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  const actor = await requireAdmin();
  return <QueueView actorId={actor.id} />;
}
