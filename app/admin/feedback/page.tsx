import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth-guard";
import { latestFeedback } from "@/lib/feedback/service";
import { FeedbackInbox } from "./FeedbackInbox";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "admin") redirect("/");
  if (!actor.twoFactorEnabled) redirect("/settings/security");
  const items = await latestFeedback();
  return <FeedbackInbox items={items.map(item => ({ ...item, createdAt: item.createdAt.toISOString() }))} />;
}
