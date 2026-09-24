import type { Metadata } from "next";
import { TwoFactorForm } from "./TwoFactorForm";

export const metadata: Metadata = { title: "Verify sign in", robots: { index: false, follow: false } };

export default function TwoFactorPage() {
  return <TwoFactorForm />;
}
