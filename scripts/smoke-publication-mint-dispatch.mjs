import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createJiti } from "jiti";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: {
  "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/"),
} });
const { beginMintDispatch, recordUnknownMintOutcome, recoverExpiredMintDispatch } = await jiti.import("../lib/publication/mint-dispatch.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const mock = {
  getChainId: async () => 97, getCode: async () => "0x60006000", getBlock: async args => args?.blockNumber === 5n
    ? { number: 5n, hash: `0x${"b".repeat(64)}` } : { number: 7n, hash: `0x${"d".repeat(64)}` },
  readContract: async ({ functionName }) => ({ MINTER_ROLE: `0x${"b".repeat(64)}`, paused: false, hasRole: true, hashToTokenId: 0n })[functionName],
  getTransactionCount: async () => 8,
};

/** Called only by the guarded local DB smoke. Optional chain owns its Anvil node. */
export async function smokeMintDispatch({ db, publisherId, candidates, chain }) {
  assert.equal(candidates.length, 2);
  const [first] = candidates, base = chain?.reader ?? mock;
  const input = candidate => ({ preparationId: candidate.preparationId, requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" });
  const data = input(first);
  const dispatch = (patch = {}, reader = base, actor = publisherId, target = first.target) => beginMintDispatch(actor, first.passportId, { ...data, ...patch }, target, reader);
  let calls = 0;
  const counted = { ...base, getChainId: async () => { calls++; return base.getChainId(); } };
  await rejects(dispatch({ acknowledgement: "PREPARE_EXACT_MINT" }, counted), 422);
  await rejects(dispatch({ nonce: 1 }, counted), 422);
  await rejects(dispatch({}, counted, "not-the-publisher"), 403);
  await rejects(dispatch({ expectedIntentSha256: "0".repeat(64) }, counted));
  await rejects(dispatch({}, counted, publisherId, { ...first.target, requiredConfirmations: 4 }));
  assert.equal(calls, 0, "unauthorized or changed requests never reach RPC");
  for (const patch of [
    { getChainId: async () => 56 }, { getCode: async () => "0x6001" },
    ...[["paused", true], ["hasRole", false], ["hashToTokenId", 1n]].map(([name, result]) => ({ readContract: args => args.functionName === name ? result : base.readContract(args) })),
    { getTransactionCount: async args => args.blockTag === "pending" ? 8 : 7 },
    { getTransactionCount: async () => -1 }, { getTransactionCount: async () => Number.MAX_SAFE_INTEGER + 1 },
  ]) await rejects(dispatch({}, { ...base, ...patch }), 503);
  let changedNonceCalls = 0;
  await rejects(dispatch({}, { ...base, getTransactionCount: async () => ++changedNonceCalls < 3 ? 7 : 8 }), 503);
  await assert.rejects(dispatch({}, { ...base, getTransactionCount: async () => { throw new Error("fictional-token-never-log"); } }),
    error => error.status === 503 && !error.message.includes("fictional-token"));
  const confirmation = await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: first.publication.confirmationId } });
  const weather = await db.evidenceFile.findUniqueOrThrow({ where: { id: confirmation.weatherFileId } });
  // These writes complete while RPC is in progress: no DB transaction/lock is held.
  for (const [mutate, restore, status] of [
    [() => db.user.update({ where: { id: publisherId }, data: { banned: true } }), () => db.user.update({ where: { id: publisherId }, data: { banned: false } }), 403],
    [() => db.passport.update({ where: { id: first.passportId }, data: { version: first.publication.passportVersion + 1 } }), () => db.passport.update({ where: { id: first.passportId }, data: { version: first.publication.passportVersion } }), 409],
    [() => db.evidenceFile.update({ where: { id: weather.id }, data: { sha256: "f".repeat(64) } }), () => db.evidenceFile.update({ where: { id: weather.id }, data: { sha256: weather.sha256 } }), 409],
    [() => db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: new Date() } }), () => db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: null } }), 409],
  ]) {
    let changed = false;
    try {
      await rejects(dispatch({}, { ...base, getTransactionCount: async args => { if (!changed) { changed = true; await mutate(); } return base.getTransactionCount(args); } }), status);
    } finally { await restore(); }
  }
  const proof = await db.publicationWalletChallenge.findUniqueOrThrow({ where: { id: first.pin.walletChallengeId } });
  await db.publicationWalletChallenge.update({ where: { id: proof.id }, data: { invalidatedAt: new Date() } });
  try { await rejects(dispatch({}, counted)); } finally { await db.publicationWalletChallenge.update({ where: { id: proof.id }, data: { invalidatedAt: null } }); }
  const saved = await db.publicationMintPreparation.findUniqueOrThrow({ where: { id: first.preparationId } });
  await db.publicationMintPreparation.update({ where: { id: saved.id }, data: { intentJson: `${saved.intentJson}\n` } });
  try { await rejects(dispatch({}, counted)); } finally { await db.publicationMintPreparation.update({ where: { id: saved.id }, data: { intentJson: saved.intentJson } }); }
  const originalNow = Date.now, initialNow = originalNow();
  Date.now = () => initialNow;
  try {
    await rejects(dispatch({}, { ...base, getTransactionCount: async args => { const value = await base.getTransactionCount(args); Date.now = () => initialNow + 20_000; return value; } }));
  } finally { Date.now = originalNow; }
  assert.equal(await db.publicationMintAttempt.count({ where: { status: { notIn: ["FINALIZED", "FAILED_TERMINAL"] }, preparation: { publication: { reservedById: publisherId } } } }), 0);

  // Race independent passport locks using the same publisher wallet/nonce.
  const attempts = candidates.flatMap(candidate => [input(candidate), input(candidate)].map(body => ({ candidate, body })));
  const outcomes = await Promise.allSettled(attempts.map(({ candidate, body }) => beginMintDispatch(publisherId, candidate.passportId, body, candidate.target, base)));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.filter(outcome => outcome.status === "rejected");
  assert.ok(rejected.every(outcome => outcome.reason.status === 409), JSON.stringify(rejected.map(({ reason }) => ({ name: reason.name, code: reason.code, status: reason.status }))));
  const index = outcomes.findIndex(outcome => outcome.status === "fulfilled"), command = outcomes[index].value;
  const winner = attempts[index].candidate, loser = candidates.find(candidate => candidate.preparationId !== winner.preparationId);
  const row = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: command.attemptId } });
  assert.equal(row.preparationId, winner.preparationId); assert.equal(row.requestId, attempts[index].body.requestId);
  assert.equal(row.publisherWallet, winner.intent.publisherWallet); assert.equal(row.chainId, 97);
  assert.equal(row.nonce, BigInt(command.request.nonce)); assert.equal(row.status, "DISPATCHING"); assert.equal(row.unknownAt, null);
  const anchored = await base.getBlock({ blockNumber: row.dispatchBlockNumber });
  assert.equal(row.dispatchBlockHash, anchored.hash); assert.equal(row.dispatchBlockNumber, anchored.number);
  assert.equal(command.request.data, winner.intent.data); assert.equal(command.request.to, winner.intent.contractAddress); assert.equal(command.request.value, "0");
  assert.equal(command.intentSha256, winner.intent.sha256); assert.equal(command.issued, false); assert.equal(command.canResend, false);
  assert.equal(await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_DISPATCH_STARTED" } }), 1);
  const pending = await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } });
  assert.equal(pending.status, "CHAIN_PENDING"); assert.equal(pending.contractAddress, null); assert.equal(pending.transactionHash, null); assert.equal(pending.tokenId, null);
  await rejects(recoverExpiredMintDispatch(winner.passportId, row.id));
  await rejects(beginMintDispatch(publisherId, winner.passportId, attempts[index].body, winner.target, counted));
  let hash, snapshot;
  if (chain) {
    snapshot = await chain.reader.request({ method: "evm_snapshot" });
    hash = await chain.send(command); // Test wallet only, outside the web process.
    const tx = await chain.reader.getTransaction({ hash });
    assert.equal(tx.nonce, command.request.nonce); assert.equal(tx.input, command.request.data); assert.equal(tx.from.toLowerCase(), command.request.from);
    assert.equal((await chain.reader.waitForTransactionReceipt({ hash })).status, "success");
    assert.equal(await chain.reader.readContract({ abi: [{ type: "function", name: "hashToTokenId", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] }],
      address: winner.target.contractAddress, functionName: "hashToTokenId", args: [`0x${winner.intent.payloadHash}`] }), 1n);
    // Deliberately do not report this hash to the app: model lost acknowledgement.
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values, code, constraint] of [
      ['UPDATE "PublicationMintAttempt" SET "nonce" = -1 WHERE "id" = $1', [row.id], "23514", "PublicationMintAttempt_shape_check"],
      ['UPDATE "PublicationMintAttempt" SET "deadlineAt" = "createdAt" WHERE "id" = $1', [row.id], "23514", "PublicationMintAttempt_shape_check"],
      ['UPDATE "PublicationMintAttempt" SET "status" = \'UNKNOWN\' WHERE "id" = $1', [row.id], "23514", "PublicationMintAttempt_shape_check"],
      ['INSERT INTO "PublicationMintAttempt" ("id","preparationId","requestId","chainId","publisherWallet","nonce","deadlineAt") VALUES ($1,$2,$3,97,$4,$5,NOW()+INTERVAL \'5 minutes\')',
        [randomUUID(), loser.preparationId, randomUUID(), row.publisherWallet, row.nonce + 1n], "23505", "PublicationMintAttempt_one_active_per_wallet"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === code && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
  } finally { await client.end(); }
  await db.publicationMintAttempt.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 600_000), deadlineAt: new Date(Date.now() - 300_000) } });
  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  const configuredActor = process.env.HARTOLIT_PUBLISHER_USER_ID;
  delete process.env.HARTOLIT_PUBLISHER_USER_ID;
  try {
    const recovered = await recoverExpiredMintDispatch(winner.passportId, row.id);
    assert.equal(recovered.status, "UNKNOWN"); assert.equal(recovered.canResend, false); assert.equal(recovered.issued, false);
    await Promise.all([recordUnknownMintOutcome(winner.passportId, row.id), recordUnknownMintOutcome(winner.passportId, row.id)]);
  } finally {
    process.env.HARTOLIT_PUBLISHER_USER_ID = configuredActor;
    await db.user.update({ where: { id: publisherId }, data: { banned: false } });
  }
  const unknown = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(unknown.status, "UNKNOWN"); assert.ok(unknown.unknownAt); assert.equal(unknown.nonce, row.nonce);
  assert.equal(await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_OUTCOME_UNKNOWN" } }), 1);
  const reads = calls;
  await rejects(beginMintDispatch(publisherId, loser.passportId, input(loser), loser.target, counted));
  assert.equal(calls, reads, "unknown wallet slot blocks another passport before RPC or send");
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } })).transactionHash, null);
  process.stdout.write(`Mint dispatch passed: exact separate consent, fresh idle nonce, post-RPC authority, cross-passport single permission, durable uncertainty/no resend and SQL constraints (${chain ? "actual owned local Anvil plus PostgreSQL" : "injected read-only RPC plus PostgreSQL"}).\n`);
  return { winner, loser, command, hash, snapshot };
}
