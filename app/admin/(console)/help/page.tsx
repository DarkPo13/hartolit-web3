import type { Metadata } from "next";
import { HelpDocument } from "@/components/help/HelpDocument";
import { adminHelp } from "@/lib/help/admin";
import { requireAdmin } from "../require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin guide", robots: { index: false, follow: false } };

export default async function AdminHelpPage() {
  await requireAdmin();
  return <HelpDocument docs={adminHelp} kind="admin" isAdmin />;
}
