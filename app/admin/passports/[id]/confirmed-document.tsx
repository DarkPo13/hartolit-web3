import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ConfirmedSnapshotDocument } from "@/components/public-snapshot/ConfirmedSnapshotDocument";
import { getActor } from "@/lib/auth-guard";
import { getDb } from "@/lib/db";
import { activePublicConfirmation } from "@/lib/public-snapshot/confirmation";
import { WorkflowError } from "@/lib/review/service";

export async function ConfirmedDocumentPage({ params, kind }: {
  params: Promise<{ id: string }>;
  kind: "certificate" | "verification";
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "admin") redirect("/");
  if (!actor.twoFactorEnabled) redirect("/settings/security");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let confirmation;
  try {
    confirmation = await activePublicConfirmation(id);
  } catch (error) {
    if (error instanceof WorkflowError && error.status === 404) notFound();
    throw error;
  }
  if (!confirmation) notFound();
  // Once issued, the certificate is the public page; these private views describe an unissued snapshot.
  const issued = await getDb().publication.findFirst({ where: { passportId: id, confirmationId: confirmation.id, status: "PUBLISHED", tokenId: { not: null } }, select: { tokenId: true } });
  if (issued?.tokenId) redirect(`/passports/${encodeURIComponent(issued.tokenId)}`);

  return <ConfirmedSnapshotDocument kind={kind} confirmation={confirmation} passportId={id} />;
}
