import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { withdrawUnmintedPublication } = await jiti.import("@/lib/publication/withdrawal");
const { beginMintDispatch } = await jiti.import("@/lib/publication/mint-dispatch");
const { reconcilePinAttempt } = await jiti.import("@/lib/publication/reconciliation");
const { decideReview } = await jiti.import("@/lib/review/service");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const dispatchInput = candidate => ({ preparationId: candidate.preparationId, requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" });

/** Pre-mint correction: a pinned, never-minted publication is withdrawn by the
 * designated publisher, after which nothing can revive it and recall is allowed.
 */
export async function smokePublicationWithdrawal({ api, db, publisherId, publisher, candidate, pinTarget, chain }) {
  const passportId = candidate.passportId, publicationId = candidate.publication.id;
  const route = `/api/admin/passports/${passportId}/publication/withdrawal`;
  const body = { publicationId, expectedSha256: candidate.publication.payloadHash, reason: "Fictional wrong dose found after pinning", acknowledgement: "WITHDRAW_UNMINTED_PUBLICATION" };
  const stored = () => db.publication.findUniqueOrThrow({ where: { id: publicationId } });
  const passport = () => db.passport.findUniqueOrThrow({ where: { id: passportId } });
  assert.equal((await stored()).status, "PINNED");
  const recall = async () => decideReview(publisherId, passportId, { version: (await passport()).version, decision: "CORRECTION_REQUIRED", note: "Fictional correction" });
  await rejects(recall(), 409); // Recall alone is blocked once publication has started.
  const refused = await api(`/api/admin/passports/${passportId}/decision`, { user: publisher, method: "POST", body: {
    version: (await passport()).version, decision: "CORRECTION_REQUIRED", note: "Fictional recall attempt" } });
  assert.equal(refused.status, 409);
  assert.deepEqual((await refused.json()).issues, ["PUBLICATION_STARTED"], "the refusal names its reason for the admin view");

  assert.equal((await api(route, { method: "POST", body })).status, 401);
  assert.equal((await api(route, { user: publisher, method: "POST", body: { ...body, acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" } })).status, 400);
  assert.equal((await api(route, { user: publisher, method: "POST", body: { ...body, reason: " " } })).status, 400);
  await rejects(withdrawUnmintedPublication("not-the-publisher", passportId, body), 403);
  await rejects(withdrawUnmintedPublication(publisherId, passportId, { ...body, expectedSha256: "0".repeat(64) }), 409);

  // Once mint permission exists the document may be on chain: withdrawal refuses.
  const preflight = { getChainId: async () => 97, getCode: async () => "0x60006000", getBlock: async () => ({ number: 4n, hash: `0x${"a".repeat(64)}` }),
    getTransactionCount: async () => 7, readContract: async ({ functionName }) => ({ MINTER_ROLE: `0x${"b".repeat(64)}`, paused: false, hasRole: true, hashToTokenId: 0n })[functionName] };
  const command = await beginMintDispatch(publisherId, passportId, dispatchInput(candidate), candidate.target, chain?.reader ?? preflight);
  try {
    await rejects(withdrawUnmintedPublication(publisherId, passportId, body), 409); // CHAIN_PENDING
    // Defense in depth: even an inconsistent PINNED status cannot hide an issued permission.
    await db.publication.update({ where: { id: publicationId }, data: { status: "PINNED" } });
    await rejects(withdrawUnmintedPublication(publisherId, passportId, body), 409);
  }
  finally {
    await db.publicationMintAttempt.deleteMany({ where: { id: command.attemptId } });
    await db.auditLog.deleteMany({ where: { publicationId, action: "PUBLICATION_MINT_DISPATCH_STARTED" } });
    await db.publication.update({ where: { id: publicationId }, data: { status: "PINNED" } });
  }

  const response = await api(route, { user: publisher, method: "POST", body });
  assert.equal(response.status, 200);
  const { withdrawal } = await response.json();
  assert.equal(withdrawal.status, "WITHDRAWN"); assert.equal(withdrawal.ipfsBytesMayRemain, true); assert.equal(withdrawal.issued, false);
  const after = await stored();
  assert.equal(after.status, "CANCELLED"); assert.ok(after.cancelledAt); assert.equal(after.walletVerifiedAt, null);
  assert.equal(after.ipfsCid, candidate.publication.ipfsCid, "the pinned CID stays on record; it is not claimed removed");
  assert.equal(after.tokenId, null);
  const audit = await db.auditLog.findFirstOrThrow({ where: { publicationId, action: "PUBLICATION_WITHDRAWN" } });
  assert.equal(audit.actorId, publisherId); assert.equal(audit.note, body.reason);

  // Nothing can revive it: repeat, mint permission and pin readback all refuse.
  await rejects(withdrawUnmintedPublication(publisherId, passportId, body), 409);
  await rejects(beginMintDispatch(publisherId, passportId, dispatchInput(candidate), candidate.target, preflight), 409);
  const pin = await db.publicationPinAttempt.findFirstOrThrow({ where: { publicationId, status: "VERIFIED" } });
  let reads = 0;
  await rejects(reconcilePinAttempt(passportId, publicationId, pin.id, pinTarget, async () => { reads++; throw new Error("must not read"); }), 409);
  assert.equal(reads, 0);
  assert.equal(await db.publicationMintAttempt.count({ where: { preparation: { publicationId } } }), 0);

  // The reviewer can now recall for correction; the confirmation is invalidated.
  await recall();
  assert.equal((await passport()).status, "CORRECTION_REQUIRED");
  assert.ok((await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: candidate.publication.confirmationId } })).invalidatedAt);
  process.stdout.write("Pre-mint withdrawal passed: publisher-only reviewed withdrawal of a pinned unminted publication, refusal after mint permission, no revival by dispatch/readback, private reason audit and recall for correction.\n");
}
