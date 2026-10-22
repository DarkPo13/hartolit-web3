import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import pg from "pg";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { observeMintAttempt } = await jiti.import("../lib/publication/mint-observation.ts");
const { HARTOLIT_PASSPORT_ABI: abi } = await jiti.import("../lib/contract.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);
const hash = digit => `0x${digit.repeat(64)}`;

export function syntheticMintFrame(intent, nonce, code, txHash) {
  const tx = { hash: txHash, chainId: 97, from: intent.publisherWallet, to: intent.contractAddress, input: intent.data,
    value: 0n, nonce, blockNumber: 5n, blockHash: hash("b"), transactionIndex: 0 };
  const receipt = { transactionHash: txHash, blockNumber: 5n, blockHash: hash("b"), transactionIndex: 0,
    from: tx.from, to: tx.to, status: "success", logs: [{ address: tx.to, blockNumber: 5n, blockHash: hash("b"),
      transactionHash: txHash, transactionIndex: 0, logIndex: 0, removed: false,
      topics: encodeEventTopics({ abi, eventName: "PassportMinted", args: { tokenId: 1n, mintedBy: tx.from, to: intent.recipientWallet } }),
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [`0x${intent.payloadHash}`, `ipfs://${intent.ipfsCid}`]),
    }] };
  return { tx, receipt, reader: {
    getChainId: async () => 97, getCode: async () => code,
    getBlock: async args => args?.blockNumber === 5n ? { number: 5n, hash: hash("b") } : { number: 7n, hash: hash("d") },
    getTransaction: async () => tx, getTransactionReceipt: async () => receipt,
    readContract: async ({ functionName }) => ({ ownerOf: intent.recipientWallet, tokenURI: `ipfs://${intent.ipfsCid}`, payloadHash: `0x${intent.payloadHash}`, hashToTokenId: 1n })[functionName],
  } };
}

export async function smokeMintObservation({ db, publisherId, dispatched, chain }) {
  const { winner, loser, command } = dispatched, attemptId = command.attemptId, passportId = winner.passportId;
  const code = chain ? await chain.reader.getCode({ address: winner.target.contractAddress }) : "0x60006000";
  const txHash = `0x${randomBytes(32).toString("hex")}`, alternateHash = `0x${randomBytes(32).toString("hex")}`;
  const frame = syntheticMintFrame(winner.intent, command.request.nonce, code, txHash), base = frame.reader;
  const observe = (reported = txHash, reader = base) => observeMintAttempt(passportId, attemptId, { transactionHash: reported }, reader);
  const count = () => db.publicationMintObservation.count({ where: { attemptId } });
  let rpc = 0;
  const noRpc = { ...base, getChainId: async () => { rpc++; throw new Error(); } };
  await rejects(observeMintAttempt(passportId, attemptId, { transactionHash: txHash, rpcUrl: "https://untrusted.example.invalid" }, noRpc), 422);
  assert.equal((await observe(null, noRpc)).status, "UNKNOWN"); assert.equal(rpc, 0);
  assert.equal((await observe(hash("a"), { ...base, getTransaction: async () => { throw Object.assign(new Error(), { name: "TransactionNotFoundError" }); } })).status, "UNKNOWN");
  for (const patch of [{ nonce: frame.tx.nonce + 1 }, { input: `${frame.tx.input}00` }, { value: 1n }, { to: `0x${"f".repeat(40)}` }]) {
    assert.equal((await observe(undefined, { ...base, getTransaction: async () => ({ ...frame.tx, ...patch }) })).status, "MISMATCH");
  }
  assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 0, "reported or mismatched hashes are not adopted");
  assert.equal((await observe(undefined, { ...base, getTransaction: async () => ({ ...frame.tx, blockNumber: null, blockHash: null }) })).status, "PENDING");
  assert.equal((await observe(undefined, { ...base, getBlock: async () => ({ number: 5n, hash: hash("b") }) })).status, "CONFIRMING");
  const verified = await observe(); assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.tokenId, "1"); assert.equal(verified.historical, true); assert.equal(verified.issued, false); assert.equal(verified.canResend, false);
  const adopted = await db.publicationMintTransaction.findUniqueOrThrow({ where: { transactionHash: txHash } });
  assert.equal(adopted.attemptId, attemptId); assert.equal(adopted.nonce, BigInt(command.request.nonce));
  const saved = await db.publicationMintObservation.findUniqueOrThrow({ where: { id: verified.observationId } });
  assert.equal(saved.transactionId, adopted.id); assert.equal(saved.status, "VERIFIED");
  assert.equal(JSON.parse(saved.resultJson).blockHash, frame.receipt.blockHash);

  // A late negative read cannot append over a newer verification.
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const stale = observe(undefined, { ...base, getTransaction: async () => { entered(); await gate; throw Object.assign(new Error(), { name: "TransactionNotFoundError" }); } });
  await waiting;
  const newer = await observe(); assert.equal(newer.status, "VERIFIED");
  const atNewer = await count(); release();
  assert.equal((await stale).status, "SUPERSEDED"); assert.equal(await count(), atNewer);
  let releaseSuccess, enteredSuccess;
  const waitingSuccess = new Promise(resolve => { enteredSuccess = resolve; });
  const gateSuccess = new Promise(resolve => { releaseSuccess = resolve; });
  const staleSuccess = observe(undefined, { ...base, getTransaction: async () => { enteredSuccess(); await gateSuccess; return frame.tx; } });
  await waitingSuccess;
  assert.equal((await observe(undefined, { ...base, getBlock: async () => ({ number: 7n, hash: hash("f") }) })).status, "REORG");
  const atReorg = await count(); releaseSuccess();
  assert.equal((await staleSuccess).status, "SUPERSEDED"); assert.equal(await count(), atReorg, "late success cannot overwrite a newer reorg observation");
  assert.equal((await observe(undefined, { ...base, getChainId: async () => { throw new Error("fictional-provider-token"); } })).status, "UNAVAILABLE");
  const revertedFrame = syntheticMintFrame(winner.intent, command.request.nonce, code, alternateHash);
  const reverted = await observe(alternateHash, { ...revertedFrame.reader, getTransactionReceipt: async () => ({ ...revertedFrame.receipt, status: "reverted", logs: [] }) });
  assert.equal(reverted.status, "REVERTED");
  assert.equal(JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: reverted.observationId } })).resultJson).blockHash, revertedFrame.receipt.blockHash);
  assert.equal(await db.publicationMintTransaction.count({ where: { attemptId } }), 2, "matching replacement candidates retain separate hash history");
  const beforeTamper = await count();
  const confirmation = await db.publicSnapshotConfirmation.findUniqueOrThrow({ where: { id: winner.publication.confirmationId } });
  let changed = false;
  try {
    await rejects(observe(undefined, { ...base, getTransaction: async () => {
      if (!changed) { changed = true; await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: new Date() } }); }
      return frame.tx;
    } }));
  } finally { await db.publicSnapshotConfirmation.update({ where: { id: confirmation.id }, data: { invalidatedAt: null } }); }
  assert.equal(await count(), beforeTamper);
  const configured = process.env.HARTOLIT_PUBLISHER_USER_ID;
  delete process.env.HARTOLIT_PUBLISHER_USER_ID;
  await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  try { assert.equal((await observe()).status, "VERIFIED", "historical recovery does not grant new actor authority"); }
  finally { process.env.HARTOLIT_PUBLISHER_USER_ID = configured; await db.user.update({ where: { id: publisherId }, data: { banned: false } }); }

  let resultFixture;
  if (chain) {
    const actualTx = await chain.reader.getTransaction({ hash: dispatched.hash });
    const actualReceipt = await chain.reader.getTransactionReceipt({ hash: dispatched.hash });
    assert.equal((await observe(dispatched.hash, chain.reader)).status, "CONFIRMING");
    await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
    const actual = await observe(dispatched.hash, chain.reader);
    assert.equal(actual.status, "VERIFIED"); assert.equal(actual.blockHash, actualReceipt.blockHash); assert.equal(actual.transactionHash, actualTx.hash);
    assert.equal(await chain.reader.request({ method: "evm_revert", params: [dispatched.snapshot] }), true);
    await chain.reader.request({ method: "anvil_mine", params: ["0x3"] });
    const reorg = await observe(dispatched.hash, { ...chain.reader, getTransaction: async () => actualTx, getTransactionReceipt: async () => actualReceipt });
    assert.equal(reorg.status, "REORG");
    assert.equal((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: actual.observationId } })).status, "VERIFIED", "old branch evidence is preserved");
    const snapshot = await chain.reader.request({ method: "evm_snapshot" });
    const replacement = await chain.send(command, 17_000_000_000n);
    assert.notEqual(replacement, dispatched.hash);
    await chain.reader.waitForTransactionReceipt({ hash: replacement });
    await chain.reader.request({ method: "anvil_mine", params: ["0x2"] });
    assert.equal((await observe(replacement, chain.reader)).status, "VERIFIED");
    resultFixture = { hash: replacement, snapshot };
  } else assert.equal((await observe(undefined, { ...base, getBlock: async () => ({ number: 7n, hash: hash("f") }) })).status, "REORG");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    for (const [query, values, constraint] of [
      ['UPDATE "PublicationMintObservation" SET "resultJson" = \'{}\' WHERE "id" = $1', [saved.id], "PublicationMintObservation_result_check"],
      ['UPDATE "PublicationMintObservation" SET "transactionId" = NULL WHERE "id" = $1', [saved.id], "PublicationMintObservation_result_check"],
      ['UPDATE "PublicationMintAttempt" SET "observationVersion" = -1 WHERE "id" = $1', [attemptId], "PublicationMintAttempt_observation_version_check"],
    ]) {
      await client.query("BEGIN");
      try { await assert.rejects(client.query(query, values), error => error.code === "23514" && error.constraint === constraint); }
      finally { await client.query("ROLLBACK"); }
    }
    await client.query("BEGIN");
    try {
      await assert.rejects(client.query('INSERT INTO "PublicationMintTransaction" ("id","attemptId","nonce","transactionHash") VALUES ($1,$2,$3,$4)',
        [randomUUID(), attemptId, BigInt(command.request.nonce) + 1n, hash("9")]), error => error.code === "23503" && error.constraint === "PublicationMintTransaction_attemptId_nonce_fkey");
    } finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
  assert.equal(await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_OBSERVED" } }), await count());
  const pending = await db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } });
  assert.equal(pending.status, "CHAIN_PENDING"); assert.equal(pending.transactionHash, null); assert.equal(pending.tokenId, null);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status, "UNKNOWN");
  assert.equal((await db.publication.findUniqueOrThrow({ where: { id: loser.publication.id } })).status, "PINNED");
  process.stdout.write(`Mint observation passed: exact call/nonce adoption, historical receipts, stale-read concurrency, revoked-actor recovery, SQL constraints and retained unissued wallet slot (${chain ? "actual local-chain reorg/replacement and PostgreSQL" : "injected RPC and PostgreSQL"}).\n`);
  return resultFixture;
}
