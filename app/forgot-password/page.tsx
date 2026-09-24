import type { Metadata } from "next";
import { ResetRequestForm } from "./ResetRequestForm";
import { isResetEmailConfigured } from "@/lib/reset-email";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ResetRequestForm available={isResetEmailConfigured()} />;
}
