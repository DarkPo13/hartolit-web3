import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicVerificationView } from "@/components/public-verifier/PublicVerificationView";
import { verifyConfiguredPassport } from "@/lib/public-verifier/config";
import { publicPassportShare } from "@/lib/public-verifier/share";

// Every request re-verifies chain and IPFS state; nothing is cached or prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Passport verification", robots: { index: false, follow: false } };

export default async function PublicPassportPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const result = await verifyConfiguredPassport(tokenId);
  if (result.status === "INVALID_REQUEST" || result.status === "NOT_FOUND") notFound();
  // Only a verified record is offered for sharing.
  const share = result.status === "VALID" ? await publicPassportShare(result.tokenId) : null;
  return <PublicVerificationView result={result} share={share} />;
}
