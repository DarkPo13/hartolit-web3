import { latestFeedback } from "@/lib/feedback/service";
import { requireAdmin } from "../require-admin";
import { FeedbackInbox } from "./FeedbackInbox";

export const dynamic = "force-dynamic";

export default async function AdminFeedbackPage() {
  await requireAdmin();
  const items = await latestFeedback();
  return <FeedbackInbox items={items.map(item => ({ ...item, createdAt: item.createdAt.toISOString() }))} />;
}
