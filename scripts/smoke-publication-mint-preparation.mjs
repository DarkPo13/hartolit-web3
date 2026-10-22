import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { createJiti } from "jiti";
import pg from "pg";
import { keccak256 } from "viem";

const jiti = createJiti(import.meta.url, { alias: {
  "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/"),
} });
const { prepareMintIntent } = await jiti.import("../lib/publication/mint-preparation.ts");
const { createMintIntent } = await jiti.import("../lib/publication/chain-mint.ts");
const { buildPublicSnapshot } = await jiti.import("../lib/public-snapshot/service.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);

/** Only called from the guarded local PostgreSQL smoke; no RPC dependency or send. */
export async function smokeMintPreparation({ db, publisherId, passportId, publication, pin, chainTarget }) {
  const target = chainTarget ?? { chainId: 97, contractAddress: `0x${"12".repeat(20)}`, contractCodeHash: keccak256("0x60006000"),
    publisherWallet: publication.publisherWallet, recipientWallet: publication.publisherWallet, requiredConfirmations: 3 };
  const expected = await createMintIntent(target, {
    canonicalJson: publication.canonicalJson, payloadHash: publication.payloadHash, ipfsCid: pin.expectedCid,
  });
  const input = { publicationId: publication.id, requestId: randomUUID(), confirmationId: publication.confirmationId,
    passportVersion: publication.passportVersion, expectedSha256: publication.payloadHash,
    expectedIntentSha256: expected.sha256, acknowledgement: "PREPARE_EXACT_MINT" };
  const prepare = (patch = {}, selected = target, actor = publisherId) => prepareMintIntent(actor, passportId, { ...input, ...patch }, selected);
  if (publication.status !== "PINNED") {
    await rejects(prepare());
    assert.equal(await db.publicationMintPreparation.count({ where: { publicationId: publication.id } }), 0);
    return;
  }
  await rejects(prepare({ acknowledgement: undefined }), 422);
  await rejects(prepare({ rpcUrl: "https://untrusted.example.invalid" }), 422);
  await rejects(prepare({}, target, "not-the-publisher"), 403);
  await rejects(prepare({ expectedSha256: "0".repeat(64) }));
  await rejects(prepare({ confirmationId: randomUUID() }));
  await rejects(prepare({ passportVersion: publication.passportVersion + 1 }));
  await rejects(prepare({ expectedIntentSha256: "0".repeat(64) }));
  await rejects(prepare({}, { ...target, recipientWallet: `0x${"56".repeat(20)}` }));
  await rejects(prepare({}, { ...target, chainId: 56 }), 503);
  for (const patch of [{ banned: true }, { twoFactorEnabled: false }]) {
    await db.user.update({ where: { id: publisherId }, data: patch });
    try { await rejects(prepare(), 403); }
    finally { await db.user.update({ where: { id: publisherId }, data: { banned: false, twoFactorEnabled: true } }); }
  }
  const proof = await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: pin.walletChallengeId } });
  for (const patch of [{ invalidatedAt: new Date() }, { signature: `0x${"00".repeat(65)}` }]) {
    await db.publicationWalletChallenge.update({ where: { id: proof.id }, data: patch });
    try { await rejects(prepare()); }
    finally { await db.publicationWalletChallenge.update({ where: { id: proof.id }, data: { invalidatedAt: proof.invalidatedAt, signature: proof.signature } }); }
  }
  const confirmation = await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: publication.confirmationId } });
  await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: new Date() } });
  try { await rejects(prepare()); }
  finally { await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: null } }); }
  const weather = await db.evidenceFile.findUniqueOrThrow({ where: { id: confirmation.weatherFileId } });
  await db.evidenceFile.update({ where: { id: weather.id }, data: { sha256: "f".repeat(64) } });
  try { await rejects(prepare()); }
  finally { await db.evidenceFile.update({ where: { id: weather.id }, data: { sha256: weather.sha256 } }); }
  await db.publication.update({ where: { id: publication.id }, data: { ipfsCid: "mismatching-receipt" } });
  try { await rejects(prepare()); }
  finally { await db.publication.update({ where: { id: publication.id }, data: { ipfsCid: publication.ipfsCid } }); }
  await db.publicationPinAttempt.update({ where: { id: pin.id }, data: { providerKey: null, providerConfigHash: null, storageProfile: null } });
  try { await rejects(prepare()); }
  finally { await db.publicationPinAttempt.update({ where: { id: pin.id }, data: {
    providerKey: pin.providerKey, providerConfigHash: pin.providerConfigHash, storageProfile: pin.storageProfile,
  } }); }
  assert.equal(await db.publicationMintPreparation.count({ where: { publicationId: publication.id } }), 0);
  // The internal PINNED revalidation must not reopen ordinary preview or another record.
  const metadata = { certificateId: confirmation.certificateId, snapshotAt: JSON.parse(confirmation.canonicalJson).snapshotAt };
  await rejects(buildPublicSnapshot(db, passportId, confirmation.weatherFileId, confirmation.chemicalFileId, metadata));
  await rejects(buildPublicSnapshot(db, passportId, confirmation.weatherFileId, confirmation.chemicalFileId, metadata, randomUUID()));
  const baseline = await db.publication.findUniqueOrThrow({ where: { id: publication.id } });
  const parallel = await Promise.all([prepare(), prepare(), prepare()]);
  assert.equal(parallel.filter(result => result.created).length, 1);
  assert.equal(new Set(parallel.map(result => result.preparation.id)).size, 1);
  assert.equal((await prepare()).created, false);
  await rejects(prepare({ requestId: randomUUID() }));
  const changed = { ...target, requiredConfirmations: 4 };
  const changedIntent = await createMintIntent(changed, { canonicalJson: publication.canonicalJson, payloadHash: publication.payloadHash, ipfsCid: publication.ipfsCid });
  await rejects(prepare({ expectedIntentSha256: changedIntent.sha256 }, changed));
  const saved = await db.publicationMintPreparation.findUniqueOrThrow({ where: { publicationId: publication.id } });
  assert.deepEqual(JSON.parse(saved.intentJson), expected);
  const { sha256, ...body } = JSON.parse(saved.intentJson);
  assert.equal(sha256, createHash("sha256").update(JSON.stringify(body)).digest("hex")); // canonical stored keys stay sorted
  assert.equal(saved.intentSha256, sha256); assert.equal(saved.pinAttemptId, pin.id);
  assert.equal(await db.auditLog.count({ where: { publicationId: publication.id, action: "PUBLICATION_MINT_PREPARED" } }), 1);
  for (const result of parallel) {
    assert.equal(result.preparation.issued, false); assert.equal(result.preparation.dispatchEnabled, false); assert.equal(result.preparation.canResend, false);
  }
  const unchanged = await db.publication.findUniqueOrThrow({ where: { id: publication.id } });
  assert.deepEqual(unchanged, baseline, "private preparation must not change publication state or fabricate chain fields");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationMintPreparation" SET "intentSha256" = $2 WHERE "id" = $1', [saved.id, "0".repeat(64)], "23514", "PublicationMintPreparation_commitment_check"],
      ['UPDATE "PublicationMintPreparation" SET "intentJson" = \'{}\' WHERE "id" = $1', [saved.id], "23514", "PublicationMintPreparation_commitment_check"],
      ['INSERT INTO "PublicationMintPreparation" ("id","publicationId","pinAttemptId","requestId","intentJson","intentSha256") VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), publication.id, pin.id, randomUUID(), saved.intentJson, saved.intentSha256], "23505", "PublicationMintPreparation_publicationId_key"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === code && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
    const foreignProof = await db.publicationWalletChallenge.findFirstOrThrow({ where: { actorId: publisherId, publicationId: { not: publication.id } } });
    await client.query("BEGIN");
    try {
      const foreignPinId = randomUUID();
      await client.query('INSERT INTO "PublicationPinAttempt" ("id","publicationId","walletChallengeId","requestId","status","closedAt") VALUES ($1,$2,$3,$4,\'CANCELLED\',NOW())',
        [foreignPinId, foreignProof.publicationId, foreignProof.id, randomUUID()]);
      await assert.rejects(client.query('UPDATE "PublicationMintPreparation" SET "pinAttemptId" = $2 WHERE "id" = $1', [saved.id, foreignPinId]),
        error => error.code === "23503" && error.constraint === "PublicationMintPreparation_pinAttemptId_publicationId_fkey",
        "an actual pin belonging to another publication cannot be linked");
    } finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
  process.stdout.write("Private mint preparation passed: exact consent, current authority/facts/proof/pin, concurrent idempotence, immutable binding and SQL constraints. No RPC or send.\n");
  return { preparationId: saved.id, target, intent: expected, passportId, publication, pin };
}
