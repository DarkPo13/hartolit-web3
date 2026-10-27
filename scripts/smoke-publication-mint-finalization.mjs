import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createJiti } from "jiti";
import pg from "pg";
import { syntheticMintFrame } from "./smoke-publication-mint-observation.mjs";
import { tickMintMonitor } from "./smoke-publication-mint-monitor.mjs";
import { smokeMintRecovery, smokeLostOriginalRecovery } from "./smoke-publication-mint-recovery.mjs";
import { smokeFailedRecovery } from "./smoke-publication-failed-recovery.mjs";
import { smokeIssuedPublicPage, withIssuedPublicPage } from "./smoke-publication-public-page.mjs";
import { browserCheckpoint, browserStage, stopAfterBrowserStage } from "./publication-browser-checkpoint.mjs";
import { smokePublicationCorrection } from "./smoke-publication-correction.mjs";
import { smokeEvidenceAccess } from "./smoke-publication-evidence-access.mjs";
import { smokePreservationHolds } from "./smoke-publication-holds.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { observeMintAttempt, reconcileMintResult, finalizeMintPublication } = await jiti.import("../lib/publication/mint-observation.ts");
const { beginMintDispatch, recordUnknownMintOutcome } = await jiti.import("../lib/publication/mint-dispatch.ts");
const { discoverMintTransaction } = await jiti.import("../lib/publication/mint-discovery.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, error => error.status === status);

export async function smokeMintFinalization({ api, base: appBase, publisher, operator, db, publisherId, dispatched, chain, finalizationFixture, probe, failure, uploaded }) {
  const { winner, loser, command } = dispatched, attemptId = command.attemptId, passportId = winner.passportId;
  const { transactionId, hash } = finalizationFixture;
  const code = chain ? await chain.reader.getCode({ address: winner.target.contractAddress }) : "0x60006000";
  const frame = syntheticMintFrame(winner.intent, command.request.nonce, code, hash), base = chain?.reader ?? frame.reader;
  const finalize = (reader = base) => finalizeMintPublication(passportId, attemptId, { transactionId }, reader);
  const report = (reader = base) => observeMintAttempt(passportId, attemptId, { transactionHash: hash }, reader);
  const stored = () => db.publication.findUniqueOrThrow({ where: { id: winner.publication.id } });
  const attempt = () => db.publicationMintAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  let rpc = 0;
  const offline = { ...base, getChainId: async () => { rpc++; throw new Error("fictional-private-rpc-detail"); } };
  await rejects(finalizeMintPublication(passportId, attemptId, { transactionId, observationId: randomUUID() }, offline), 422);
  await rejects(finalizeMintPublication(passportId, attemptId, { transactionId: randomUUID() }, offline));
  await rejects(finalizeMintPublication(loser.passportId, attemptId, { transactionId }, offline), 404);
  assert.equal(rpc, 0);
  const prior = await db.publicationMintAttempt.findMany({ where: { chainId: 97, publisherWallet: winner.intent.publisherWallet,
    id: { not: attemptId }, status: { in: ["FINALIZED", "FAILED_TERMINAL"] } }, include: { finalizedObservation: true, failedObservation: true } });
  const priorBlocks = new Set(prior.map(row => JSON.parse((row.finalizedObservation ?? row.failedObservation).resultJson).blockNumber));
  for (const [reader, expected] of [
    [offline, "UNAVAILABLE"],
    [{ ...frame.reader, getTransaction: async () => ({ ...frame.tx, blockNumber: null, blockHash: null }) }, "PENDING"],
    [{ ...frame.reader, getBlock: async () => ({ number: 5n, hash: frame.receipt.blockHash }) }, "CONFIRMING"],
    [{ ...frame.reader, getTransactionReceipt: async () => ({ ...frame.receipt, status: "reverted", logs: [] }) }, "REVERTED"],
    [{ ...frame.reader, getBlock: async () => ({ number: 7n, hash: `0x${"f".repeat(64)}` }) }, "REORG"],
    [{ ...frame.reader, getTransaction: async () => ({ ...frame.tx, input: "0x" }) }, "MISMATCH"],
  ]) {
    if (prior.length && ["UNAVAILABLE", "CONFIRMING", "REORG"].includes(expected)) {
      await rejects(finalize(reader), 503); // A global RPC/branch failure cannot bypass earlier closed-nonce receipts.
      assert.equal((await attempt()).finalizedAt, null); assert.equal((await stored()).transactionHash, null);
      continue;
    }
    const isolated = { ...reader, getBlock: args => args?.blockNumber !== undefined && priorBlocks.has(args.blockNumber.toString())
      ? base.getBlock(args) : reader.getBlock(args) };
    const result = await finalize(isolated); assert.equal(result.status, expected);
    assert.equal(result.publicationStatus, "CHAIN_PENDING"); assert.equal(result.issued, false); assert.equal(result.canResend, false);
    assert.equal((await attempt()).finalizedAt, null); assert.equal((await stored()).transactionHash, null);
  }
  const originalNow = Date.now, initialNow = originalNow(), beforeExpired = (await attempt()).observationVersion;
  Date.now = () => initialNow;
  try { await rejects(finalize({ ...base, getTransaction: async args => { const tx = await base.getTransaction(args); Date.now = () => initialNow + 16_000; return tx; } })); }
  finally { Date.now = originalNow; }
  assert.equal((await attempt()).observationVersion, beforeExpired);

  const lease = { token: randomUUID() }, beforeLeaseExpiry = (await attempt()).observationVersion;
  await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorToken: lease.token, monitorUntil: new Date(Date.now() + 90_000) } });
  try {
    await rejects(finalizeMintPublication(passportId, attemptId, { transactionId }, { ...base, getTransaction: async args => {
      await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorUntil: new Date("2000-01-01T00:00:00Z") } });
      return base.getTransaction(args);
    } }, lease));
    assert.equal((await attempt()).observationVersion, beforeLeaseExpiry, "expired receipt worker appends no proof or observation");
    assert.equal((await attempt()).finalizedAt, null);
    assert.equal((await stored()).status, "CHAIN_PENDING");
  } finally { await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorToken: null, monitorUntil: null } }); }

  // Recording an already authorized external result survives actor/config revocation.
  const configured = process.env.HARTOLIT_PUBLISHER_USER_ID;
  delete process.env.HARTOLIT_PUBLISHER_USER_ID; await db.user.update({ where: { id: publisherId }, data: { banned: true } });
  let first;
  try {
    if (chain) {
      let outcome;
      for (let tick = 0; tick < 3; tick++) {
        outcome = await tickMintMonitor(db, passportId, attemptId, base);
        if (outcome.status !== "REORG") break;
      }
      assert.equal(outcome.status, "VERIFIED", "the worker discovers and finalizes the actual current-branch mint");
      first = { observationId: (await attempt()).finalizedObservationId, publicationStatus: (await stored()).status };
    } else first = await finalize();
    assert.equal(first.publicationStatus, "PUBLISHED");
  }
  finally { process.env.HARTOLIT_PUBLISHER_USER_ID = configured; await db.user.update({ where: { id: publisherId }, data: { banned: false } }); }
  const published = await stored(), closed = await attempt(), receipt = await base.getTransactionReceipt({ hash });
  assert.equal(closed.status, "FINALIZED"); assert.equal(closed.finalizedObservationId, first.observationId);
  assert.equal(closed.quarantinedAt, null); assert.equal(closed.nonce, BigInt(command.request.nonce));
  assert.equal(published.contractAddress, winner.target.contractAddress); assert.equal(published.transactionHash, hash); assert.equal(published.tokenId, "1");
  assert.equal(JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: closed.finalizedObservationId } })).resultJson).blockHash, receipt.blockHash);
  // The admin views must present the record as issued, never as an unissued snapshot.
  const overview = await (await api(`/api/admin/passports/${passportId}/publication`, { user: publisher })).json();
  assert.deepEqual(overview.reservations.find(row => row.id === published.id).issued, { tokenId: published.tokenId, chainId: published.chainId,
    contractAddress: published.contractAddress, transactionHash: published.transactionHash, previousTokenIds: [] }, "issued chain identifiers reach the admin view; no earlier numbers");
  assert.equal(overview.reservations.find(row => row.id === probe.publication.id)?.issued ?? null, null, "an unissued publication has no chain identifiers");
  for (const view of ["certificate", "verification"]) {
    const response = await api(`/admin/passports/${passportId}/${view}`, { user: publisher });
    assert.equal(response.status, 307, `issued ${view} view redirects`);
    assert.equal(new URL(response.headers.get("location"), "http://x.invalid").pathname, `/passports/${published.tokenId}`);
  }
  if (browserStage("issued")) {
    const pause = links => browserCheckpoint("issued", { base: appBase, actors: { "/publisher": publisher, ...(operator ? { "/operator": operator } : {}) }, label: `${passportId}, unissued ${probe.passportId}`, links });
    if (chain && uploaded) await withIssuedPublicPage({ publication: published, chain, uploaded }, page => pause({ "/public": `${page}/passports/${published.tokenId}` }));
    else await pause();
    stopAfterBrowserStage("issued");
  }
  // List marks (D64), checked while the correction is open: the issued filter,
  // the open correction, and the operator's views.
  const checkMarks = async () => {
    const json = async (route, user) => { const response = await api(route, { user }); assert.equal(response.status, 200, route); return response.json(); };
    const issuedQueue = await json("/api/admin/passports?status=ISSUED", publisher);
    assert.deepEqual(issuedQueue.items.find(item => item.id === passportId)?.marks, { issuedTokenId: published.tokenId, correctsTokenId: null, correctionOpened: true },
      "the queue marks the issued record and its open correction");
    assert.ok(issuedQueue.items.length && issuedQueue.items.every(item => item.marks.issuedTokenId), "the issued filter lists only issued records");
    const unissued = (await json("/api/admin/passports?status=ALL", publisher)).items.find(item => item.id === probe.passportId);
    assert.deepEqual(unissued?.marks, { issuedTokenId: null, correctsTokenId: null, correctionOpened: false }, "an unissued record carries no marks");
    const correctionDraft = (await db.publicationCorrection.findUniqueOrThrow({ where: { supersededPublicationId: published.id } })).correctionPassportId;
    assert.equal((await json("/api/drafts", operator)).drafts.find(draft => draft.id === correctionDraft)?.correctsTokenId, published.tokenId,
      "the operator's draft list marks the correction draft");
    assert.equal((await json("/api/passports/mine", operator)).passports.find(item => item.id === passportId)?.marks.issuedTokenId, published.tokenId,
      "the operator's passports mark the issued record");
  };
  // Post-mint correction on the real published record; on the actual chain the
  // anonymous page must also be VALID and say a correction is in progress.
  // An offline Kubo run has no captured upload bytes for the page check.
  await smokePublicationCorrection({ api, db, publisherId, publisher, publication: published, passportId, whileOpen: async () => {
    await checkMarks();
    if (chain && uploaded) await smokeIssuedPublicPage({ publication: published, passportId, chain, uploaded, correctionPending: true });
  } });
  await smokeEvidenceAccess({ api, db, publisher, issuedPassportId: passportId, unissuedPassportId: probe.passportId });
  await smokePreservationHolds({ api, db, publisherId, publisher, issuedPassportId: passportId });
  const repeats = await Promise.all([finalize(), finalize()]);
  assert.ok(repeats.every(row => row.status === "SUPERSEDED" || row.publicationStatus === "PUBLISHED"));
  assert.equal((await attempt()).finalizedObservationId, first.observationId, "first finalization proof never changes on replay");
  assert.equal(await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_FINALIZED" } }), 1);
  assert.equal((await tickMintMonitor(db, passportId, attemptId, base)).status, "VERIFIED");
  assert.equal((await attempt()).finalizedObservationId, first.observationId, "scheduled canonical checks preserve first proof");
  assert.equal((await db.publicationMintResult.findUniqueOrThrow({ where: { attemptId } })).status, "VERIFIED");
  // D76: an unchanged closed proof settles only 24 hours after closure and ten times the depth deep; then it is never claimed again.
  const depth = BigInt(winner.intent.requiredConfirmations);
  const included = BigInt(JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: first.observationId } })).resultJson).blockNumber);
  const headed = tip => ({ ...base, getBlock: async args => args?.blockNumber === undefined || args.blockNumber === tip.number ? tip : base.getBlock(args) });
  const shallow = headed(await base.getBlock({ blockNumber: included + depth - 1n }));
  const real = await base.getBlock(), deepTip = { ...real, number: included + 10n * depth + 1n };
  const atReal = args => args?.blockNumber === deepTip.number ? { ...args, blockNumber: real.number } : args;
  const deep = { ...headed(deepTip), getCode: async args => base.getCode(atReal(args)), readContract: async args => base.readContract(atReal(args)) };
  if (deepTip.number <= real.number) deepTip.number = real.number;
  assert.equal((await tickMintMonitor(db, passportId, attemptId, deep)).status, "VERIFIED");
  assert.equal((await attempt()).monitorSettledAt, null, "a closure younger than 24 hours is not settled");
  // The shape CHECK keeps every attempt time after its creation, so age them together.
  const age = shift => db.$executeRawUnsafe(`UPDATE "PublicationMintAttempt" SET "createdAt" = "createdAt" + $2::interval,
    "deadlineAt" = "deadlineAt" + $2::interval, "unknownAt" = "unknownAt" + $2::interval, "finalizedAt" = "finalizedAt" + $2::interval WHERE "id" = $1::uuid`, attemptId, shift);
  assert.equal(await age("-25 hours"), 1);
  try {
    assert.equal((await tickMintMonitor(db, passportId, attemptId, shallow)).status, "VERIFIED");
    assert.equal((await attempt()).monitorSettledAt, null, "a proof shallower than ten times the depth is not settled");
    assert.equal((await tickMintMonitor(db, passportId, attemptId, deep)).status, "VERIFIED");
    assert.ok((await attempt()).monitorSettledAt, "an old, deep and unchanged proof settles");
    let settledRpc = 0;
    assert.equal((await tickMintMonitor(db, passportId, attemptId, { ...base, getChainId: async () => { settledRpc++; return 97; } })).status, "SKIPPED");
    assert.equal(settledRpc, 0, "a settled proof is no longer claimed or read");
    const settledClient = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    await settledClient.connect();
    try {
      const open = await db.publicationMintAttempt.findFirst({ where: { status: { in: ["DISPATCHING", "UNKNOWN"] } }, select: { id: true } });
      for (const [query, values] of [['UPDATE "PublicationMintAttempt" SET "monitorSettledAt"=\'infinity\' WHERE "id"=$1', [attemptId]],
        ...(open ? [['UPDATE "PublicationMintAttempt" SET "monitorSettledAt"=NOW() WHERE "id"=$1', [open.id]]] : [])]) {
        await settledClient.query("BEGIN");
        try { await assert.rejects(settledClient.query(query, values), error => error.code === "23514" && error.constraint === "PublicationMintAttempt_monitor_settled_check"); }
        finally { await settledClient.query("ROLLBACK"); }
      }
    } finally { await settledClient.end(); }
  } finally {
    await db.publicationMintAttempt.update({ where: { id: attemptId }, data: { monitorSettledAt: null } });
    assert.equal(await age("25 hours"), 1);
  }
  await rejects(recordUnknownMintOutcome(passportId, attemptId));
  let lateSearchRpc = 0;
  const searches = await db.publicationMintDiscovery.count({ where: { attemptId } });
  await rejects(discoverMintTransaction(passportId, attemptId, {}, { ...base, getChainId: async () => { lateSearchRpc++; throw new Error(); } }));
  assert.equal(lateSearchRpc, 0); assert.equal(await db.publicationMintDiscovery.count({ where: { attemptId } }), searches);
  await rejects(observeMintAttempt(passportId, attemptId, { transactionHash: null }, offline));
  await rejects(observeMintAttempt(passportId, attemptId, { transactionHash: `0x${randomBytes(32).toString("hex")}` }, offline));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const negative = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "UNKNOWN" } });
    for (const [query, values, code, constraint, deferred] of [
      ['UPDATE "PublicationMintAttempt" SET "finalizedObservationId"=NULL WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_shape_check"],
      ['UPDATE "PublicationMintAttempt" SET "quarantinedAt"="finalizedAt"-INTERVAL \'1 second\' WHERE "id"=$1', [attemptId], "23514", "PublicationMintAttempt_shape_check"],
      ['UPDATE "PublicationMintAttempt" SET "finalizedObservationId"=$2 WHERE "id"=$1', [attemptId, negative.id], "23503", "PublicationMintAttempt_finalizedObservationId_id_finalizat_fkey", true],
      ['UPDATE "Publication" SET "tokenId"=NULL WHERE "id"=$1', [winner.publication.id], "23514", "Publication_finalized_chain_check"],
      ['INSERT INTO "PublicationMintAttempt" ("id","preparationId","requestId","chainId","publisherWallet","nonce","deadlineAt") VALUES ($1,$2,$3,97,$4,$5,NOW()+INTERVAL \'5 minutes\')',
        [randomUUID(), loser.preparationId, randomUUID(), winner.intent.publisherWallet, closed.nonce], "23505", "PublicationMintAttempt_chainId_publisherWallet_nonce_key"],
    ]) {
      await client.query("BEGIN");
      try {
        if (deferred) await client.query('SET CONSTRAINTS "PublicationMintAttempt_finalizedObservationId_id_finalizat_fkey" IMMEDIATE');
        await assert.rejects(client.query(query, values), error => error.code === code && error.constraint === constraint);
      } finally { await client.query("ROLLBACK"); }
    }
    const anotherProof = await db.publicationMintObservation.findFirstOrThrow({ where: { attemptId, status: "VERIFIED", id: { not: first.observationId } } });
    await client.query("BEGIN");
    try {
      await client.query('SET CONSTRAINTS "PublicationMintAttempt_finalizedObservationId_id_finalizat_fkey" IMMEDIATE');
      await assert.rejects(client.query('INSERT INTO "PublicationMintAttempt" ("id","preparationId","requestId","chainId","publisherWallet","nonce","deadlineAt","status","finalizedAt","finalizedObservationId","finalizationStatus") VALUES ($1,$2,$3,97,$4,0,NOW()+INTERVAL \'5 minutes\',\'FINALIZED\',NOW(),$5,\'VERIFIED\')',
        [randomUUID(), loser.preparationId, randomUUID(), `0x${"e".repeat(40)}`, anotherProof.id]),
        error => error.code === "23503" && error.constraint === "PublicationMintAttempt_finalizedObservationId_id_finalizat_fkey",
        "an unused VERIFIED proof from another attempt cannot finalize this attempt");
    } finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }

  const idle = chain?.reader ?? { ...base,
    getTransactionCount: async () => command.request.nonce + 1,
    readContract: async ({ functionName }) => ({ MINTER_ROLE: `0x${"c".repeat(64)}`, paused: false, hasRole: true, hashToTokenId: 0n })[functionName],
  };
  const dispatchNext = (reader = idle) => beginMintDispatch(publisherId, loser.passportId, { preparationId: loser.preparationId, requestId: randomUUID(),
    expectedIntentSha256: loser.intent.sha256, acknowledgement: "SEND_EXACT_MINT" }, loser.target, reader);
  const proof = JSON.parse((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: first.observationId } })).resultJson);
  // A receipt whose block is no longer canonical blocks the next permission, even
  // before a scheduled observer has quarantined that old publication.
  await rejects(dispatchNext({ ...idle, getBlock: async args => args?.blockNumber === BigInt(proof.blockNumber)
    ? { number: BigInt(proof.blockNumber), hash: `0x${"f".repeat(64)}` } : idle.getBlock(args) }), 503);
  await rejects(dispatchNext({ ...idle, getBlock: async args => args?.blockNumber === undefined
    ? idle.getBlock({ blockNumber: BigInt(proof.blockNumber) }) : idle.getBlock(args) }), 503);
  await rejects(dispatchNext({ ...idle, getTransactionCount: async () => command.request.nonce }), 503);
  assert.equal(await db.publicationMintAttempt.count({ where: { preparationId: loser.preparationId } }), 0);
  let changed = false;
  await rejects(dispatchNext({ ...idle, getTransactionCount: async args => {
    if (!changed) { changed = true; assert.equal((await report()).publicationStatus, "PUBLISHED"); }
    return idle.getTransactionCount(args);
  } }));
  assert.equal((await attempt()).quarantinedAt, null, "fresh same-receipt diagnostics are not reorgs");
  const next = await Promise.allSettled([dispatchNext(), dispatchNext()]);
  assert.equal(next.filter(row => row.status === "fulfilled").length, 1);
  assert.ok(next.filter(row => row.status === "rejected").every(row => row.reason.status === 409));
  const nextCommand = next.find(row => row.status === "fulfilled").value;
  assert.equal(nextCommand.request.nonce, command.request.nonce + 1);
  const recovery = await smokeMintRecovery({ db, publisherId, passportId, attemptId, nextCommand, base });
  await smokeFailedRecovery({ db, publisherId, failure, active: nextCommand, successful: { passportId, attemptId, hash }, successReader: base, chain });
  const previousQuarantines = await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_QUARANTINED" } });

  if (chain) {
    const tx = await base.getTransaction({ hash });
    assert.equal(await base.request({ method: "evm_revert", params: [finalizationFixture.snapshot] }), true);
    const cancellation = await chain.cancel(command);
    const cancelled = await base.getTransaction({ hash: cancellation });
    assert.equal(cancelled.nonce, command.request.nonce); assert.equal(cancelled.input, "0x");
    assert.equal((await base.waitForTransactionReceipt({ hash: cancellation })).status, "success");
    await base.request({ method: "anvil_mine", params: ["0x2"] });
    const reorg = await tickMintMonitor(db, passportId, attemptId, { ...base, getTransaction: async () => tx, getTransactionReceipt: async () => receipt });
    assert.equal(reorg.status, "REORG"); assert.equal((await stored()).status, "CHAIN_SUSPENDED");
    // A previously returned command cannot be recalled. Record its result, but
    // do not release another slot while the earlier publication is quarantined.
    const laterHash = await chain.send(nextCommand);
    await base.waitForTransactionReceipt({ hash: laterHash }); await base.request({ method: "anvil_mine", params: ["0x2"] });
    const later = await observeMintAttempt(loser.passportId, nextCommand.attemptId, { transactionHash: laterHash }, base);
    assert.equal(later.status, "VERIFIED");
    await assert.rejects(finalizeMintPublication(loser.passportId, nextCommand.attemptId, { transactionId: later.matchedTransactionId }, base),
      error => error.status === 409 && error.message.includes("quarantined"));
  } else {
    const reorg = await tickMintMonitor(db, passportId, attemptId, { ...base, getBlock: async () => ({ number: 7n, hash: `0x${"f".repeat(64)}` }) });
    assert.equal(reorg.status, "REORG"); assert.equal((await stored()).status, "CHAIN_SUSPENDED");
  }
  const quarantined = await attempt(), suspended = await stored();
  assert.ok(quarantined.quarantinedAt); assert.equal(quarantined.status, "FINALIZED", "quarantine must not compete for an already occupied active slot");
  assert.equal(suspended.status, "CHAIN_SUSPENDED"); assert.equal(suspended.transactionHash, published.transactionHash);
  assert.equal(suspended.tokenId, published.tokenId); assert.equal(quarantined.finalizedObservationId, first.observationId);
  assert.equal((await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: nextCommand.attemptId } })).status, "DISPATCHING");
  await rejects(finalize());
  // Even a later successful private selection cannot clear the sticky quarantine.
  const selectedAgain = await reconcileMintResult(passportId, attemptId, { transactionId }, frame.reader);
  assert.equal(selectedAgain.status, "VERIFIED"); assert.equal(selectedAgain.publicationStatus, "CHAIN_SUSPENDED");
  assert.equal((await tickMintMonitor(db, passportId, attemptId, frame.reader)).status, "VERIFIED");
  assert.equal((await stored()).status, "CHAIN_SUSPENDED", "the worker never clears sticky quarantine");
  let probeRpc = 0;
  await assert.rejects(beginMintDispatch(publisherId, probe.passportId, { preparationId: probe.preparationId, requestId: randomUUID(),
    expectedIntentSha256: probe.intent.sha256, acknowledgement: "SEND_EXACT_MINT" }, probe.target,
  { ...idle, getChainId: async () => { probeRpc++; throw new Error(); } }), error => error.status === 409 && error.message.includes("quarantined"));
  assert.equal(probeRpc, 0); assert.equal(await db.publicationMintAttempt.count({ where: { preparationId: probe.preparationId } }), 0);
  assert.equal(await db.auditLog.count({ where: { publicationId: winner.publication.id, action: "PUBLICATION_MINT_QUARANTINED" } }), previousQuarantines + 1);
  await smokeLostOriginalRecovery({ db, publisherId, passportId, attemptId, base, previous: recovery, actualChain: !!chain });
  assert.equal((await db.publicationMintObservation.findUniqueOrThrow({ where: { id: first.observationId } })).status, "VERIFIED");
  process.stdout.write(`Mint finalization passed: fresh exact publication, immutable proof/replay, permanent nonce claims, prior-anchor checks, next-slot concurrency and sticky cross-attempt quarantine (${chain ? "actual rollback/cancellation after release plus PostgreSQL" : "injected RPC plus PostgreSQL"}). No public certificate or broadcaster enabled.\n`);
}
