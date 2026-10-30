import { AdminRecords } from "../../AdminRecords";
import { requireAdmin } from "../require-admin";

export const dynamic = "force-dynamic";

export default async function AdminPublicationsPage() {
  await requireAdmin();
  return <AdminRecords view="publications" />;
}
