import { requireAdmin } from "../../require-admin";
import { PassportDetail } from "./PassportDetail";

export const dynamic = "force-dynamic";

export default async function AdminPassportPage({ params }: { params: Promise<{ id: string }> }) {
  const [actor, { id }] = await Promise.all([requireAdmin(), params]);
  return <PassportDetail key={id} id={id} actorId={actor.id} />;
}
