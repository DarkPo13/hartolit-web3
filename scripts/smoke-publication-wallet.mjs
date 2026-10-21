// Real EIP-191 signatures and PostgreSQL checks; no RPC, pinning, minting or persistent keys.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export async function smokeWalletProof({
  api, db, base, publisher, other, operator, unverified, publisherId, signingAccount,
  route, reservationId, passportId, confirmation, weatherFileId, marker,
  foreignRoute, foreignReservationId, foreignPassportId,
}) {
  const challengeRoute = `${route}/wallet-challenge`, proofRoute = `${route}/wallet-proof`;
  const challengeRequest = (patch = {}, user = publisher, origin = base) => api(challengeRoute, {
    user, origin, method: "POST", body: { publicationId: reservationId, ...patch },
  });
  assert.equal((await api(challengeRoute, { method: "POST", body: { publicationId: reservationId } })).status, 401);
  for (const user of [other, operator, unverified]) assert.equal((await challengeRequest({}, user)).status, 403);
  assert.equal((await challengeRequest({}, publisher, null)).status, 403);
  assert.equal((await challengeRequest({}, publisher, "https://evil.invalid")).status, 403);
  assert.equal((await challengeRequest({ message: marker })).status, 400, "caller cannot choose the signed message");
  assert.equal((await challengeRequest({ publicationId: "invalid" })).status, 400);
  assert.equal((await challengeRequest({ publicationId: randomUUID() })).status, 404);
  assert.equal((await challengeRequest({ publicationId: foreignReservationId })).status, 404, "reservation must belong to the route's passport");

  const replies = await Promise.all([challengeRequest(), challengeRequest(), challengeRequest()]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 200, 201], "one concurrent challenge creator");
  const challenges = await Promise.all(replies.map(async (r) => (await r.json()).challenge));
  const first = challenges[0];
  assert.ok(challenges.every((c) => c.id === first.id), "concurrent requests reuse one live challenge");
  const stored = await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(stored.actorId, publisherId);
  assert.equal(stored.message, first.message);
  assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 300_000);
  assert.match(stored.nonce, /^[a-f0-9]{64}$/);
  assert.equal(stored.signature, null);
  for (const text of [base, reservationId, confirmation.preview.snapshot.certificateId, confirmation.preview.sha256, signingAccount.address.toLowerCase(), "Chain ID: 97"]) {
    assert.ok(first.message.includes(text), "signed message identifies application and exact reservation");
  }
  assert.ok(!first.message.includes(marker));
  assert.equal(await db.auditLog.count({ where: { publicationId: reservationId, action: "PUBLICATION_WALLET_CHALLENGED" } }), 1);
  const signature = await signingAccount.signMessage({ message: first.message });
  const body = { publicationId: reservationId, challengeId: first.id, signature };
  const prove = (patch = {}, user = publisher, origin = base) => api(proofRoute, { user, origin, method: "POST", body: { ...body, ...patch } });
  assert.equal((await api(proofRoute, { method: "POST", body })).status, 401);
  for (const user of [other, operator, unverified]) assert.equal((await prove({}, user)).status, 403);
  assert.equal((await prove({}, publisher, null)).status, 403);
  assert.equal((await prove({}, publisher, "https://evil.invalid")).status, 403);
  assert.equal((await prove({ signature: "0x12" })).status, 400);
  assert.equal((await prove({ message: first.message })).status, 400);
  assert.equal((await prove({ challengeId: randomUUID() })).status, 409);
  const wrongAccount = privateKeyToAccount(generatePrivateKey());
  assert.equal((await prove({ signature: await wrongAccount.signMessage({ message: first.message }) })).status, 403, "a different wallet's real signature is rejected");
  assert.equal((await prove({ signature: await signingAccount.signMessage({ message: `${first.message}\nAltered` }) })).status, 403, "message bytes are exact");
  assert.equal((await prove({ signature: `0x${"00".repeat(65)}` })).status, 403, "malformed recovery fails closed");
  assert.equal((await api(`${foreignRoute}/wallet-proof`, { user: publisher, method: "POST", body: { ...body, publicationId: foreignReservationId } })).status, 409);

  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  assert.equal((await prove()).status, 401);
  await db.user.update({ where: { id: publisherId }, data: { banned: false, twoFactorEnabled: false } });
  assert.equal((await prove()).status, 403);
  await db.user.update({ where: { id: publisherId }, data: { twoFactorEnabled: true, role: "user" } });
  assert.equal((await prove()).status, 403);
  await db.user.update({ where: { id: publisherId }, data: { role: "admin" } });
  await db.evidenceFile.update({ where: { id: weatherFileId }, data: { status: "REJECTED" } });
  assert.equal((await prove()).status, 422, "a valid signature cannot bypass evidence revalidation");
  await db.evidenceFile.update({ where: { id: weatherFileId }, data: { status: "READY" } });
  await db.passport.update({ where: { id: passportId }, data: { version: 5 } });
  assert.equal((await prove()).status, 409, "a valid signature cannot bypass a changed version");
  await db.passport.update({ where: { id: passportId }, data: { version: 4 } });
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: new Date() } });
  assert.equal((await prove()).status, 409);
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: null } });
  await db.publicationWalletChallenge.update({ where: { id: first.id }, data: { origin: "https://evil.invalid" } });
  assert.equal((await prove()).status, 409, "stored challenge context is rechecked");
  await db.publicationWalletChallenge.update({ where: { id: first.id }, data: { origin: base } });
  const ownerId = (await db.passport.findUniqueOrThrow({ where: { id: passportId } })).ownerId;
  await db.publicationWalletChallenge.update({ where: { id: first.id }, data: { actorId: ownerId } });
  assert.equal((await prove()).status, 409, "challenge is bound to its MFA actor");
  await db.publicationWalletChallenge.update({ where: { id: first.id }, data: { actorId: publisherId } });
  await db.publication.update({ where: { id: reservationId }, data: { publisherWallet: wrongAccount.address.toLowerCase() } });
  assert.equal((await prove()).status, 409, "reservation wallet must still match the allowlist");
  await db.publication.update({ where: { id: reservationId }, data: { publisherWallet: signingAccount.address.toLowerCase(), chainId: 56 } });
  assert.equal((await prove()).status, 409, "proof cannot change to Mainnet");
  await db.publication.update({ where: { id: reservationId }, data: { chainId: 97 } });
  assert.equal((await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: first.id } })).consumedAt, null);
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: reservationId } })).walletVerifiedAt, null);
  assert.equal(await db.auditLog.count({ where: { publicationId: reservationId, action: "PUBLICATION_WALLET_VERIFIED" } }), 0);

  await db.publicationWalletChallenge.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await prove()).status, 409, "expired signatures cannot be used");
  const renewed = await challengeRequest(); assert.equal(renewed.status, 201);
  const fresh = (await renewed.json()).challenge;
  assert.notEqual(fresh.id, first.id);
  assert.ok((await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: first.id } })).invalidatedAt);
  assert.equal((await prove()).status, 409, "renewal cannot reactivate the old challenge");
  assert.equal((await prove({ challengeId: fresh.id })).status, 403, "old signature cannot be moved to a fresh nonce");
  const freshSignature = await signingAccount.signMessage({ message: fresh.message });
  const freshBody = { ...body, challengeId: fresh.id, signature: freshSignature };
  const accepted = await Promise.all([0, 1, 2].map(() => prove({ challengeId: fresh.id, signature: freshSignature })));
  assert.deepEqual(accepted.map((r) => r.status).sort(), [200, 409, 409], "one proof succeeds, concurrent replays fail");
  const successResponse = accepted.find((r) => r.status === 200);
  assert.equal(successResponse.headers.get("cache-control"), "private, no-store");
  const success = (await successResponse.json()).proof;
  const consumed = await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: fresh.id } });
  const publication = await db.publication.findUniqueOrThrow({ where: { id: reservationId } });
  assert.equal(consumed.signature, freshSignature);
  assert.equal(consumed.consumedAt.toISOString(), success.walletVerifiedAt);
  assert.equal(publication.walletVerifiedAt.toISOString(), success.walletVerifiedAt);
  assert.equal(publication.canonicalJson, confirmation.preview.canonicalJson, "proof never changes confirmed bytes");
  assert.equal(publication.payloadHash, confirmation.preview.sha256);
  assert.equal(success.publicationId, reservationId);
  assert.equal(success.walletAddress, signingAccount.address.toLowerCase());
  assert.equal(publication.status, "RESERVED");
  assert.equal(publication.ipfsCid, null); assert.equal(publication.transactionHash, null); assert.equal(publication.tokenId, null);
  assert.equal(await db.auditLog.count({ where: { publicationId: reservationId, action: "PUBLICATION_WALLET_VERIFIED" } }), 1);
  assert.equal((await challengeRequest()).status, 409);
  assert.equal((await prove({ challengeId: fresh.id, signature: freshSignature })).status, 409);
  const history = (await (await api(route, { user: other })).json()).reservations;
  assert.equal(history[0].walletVerifiedAt, success.walletVerifiedAt);
  assert.ok(!JSON.stringify(history).includes(freshSignature), "history does not expose signatures");

  const foreignChallengeResponse = await api(`${foreignRoute}/wallet-challenge`, { user: publisher, method: "POST", body: { publicationId: foreignReservationId } });
  assert.equal(foreignChallengeResponse.status, 201);
  const foreignChallenge = (await foreignChallengeResponse.json()).challenge;
  const foreignSignature = await signingAccount.signMessage({ message: foreignChallenge.message });
  const [racingProof, recall] = await Promise.all([
    api(`${foreignRoute}/wallet-proof`, { user: publisher, method: "POST", body: {
      publicationId: foreignReservationId, challengeId: foreignChallenge.id, signature: foreignSignature,
    } }),
    api(`/api/admin/passports/${foreignPassportId}/decision`, { user: publisher, method: "POST", body: {
      version: 4, decision: "CORRECTION_REQUIRED", note: "Fictional wallet-proof race",
    } }),
  ]);
  assert.ok([200, 409].includes(racingProof.status)); assert.equal(recall.status, 200);
  const recalled = await db.publication.findUniqueOrThrow({ where: { id: foreignReservationId } });
  assert.equal(recalled.status, "CANCELLED"); assert.equal(recalled.walletVerifiedAt, null);
  assert.ok((await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: foreignChallenge.id } })).invalidatedAt);
  return { challengeId: fresh.id, body: freshBody };
}
