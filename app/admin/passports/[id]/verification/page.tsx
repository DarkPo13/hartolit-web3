import { ConfirmedDocumentPage } from "../confirmed-document";

export const dynamic = "force-dynamic";

export default function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  return <ConfirmedDocumentPage params={params} kind="verification" />;
}
