import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { localMintChain } from "./local-mint-chain.mjs";
import { preparePinRecord, startFakeKubo } from "./smoke-publication-upload-action.mjs";
import { createServer } from "node:http";
import { browserCheckpoint, browserStage, stopAfterBrowserStage } from "./publication-browser-checkpoint.mjs";

/** D68: mint routes. Without mint configuration nothing is offered or authorized.
 * With an owned Anvil (PUBLICATION_LOCAL_CHAIN=1) a fresh publisher wallet prepares,
 * receives one fixed-nonce permission, sends the exact request as the browser wallet
 * would, reports the hash, and a monitoring check finalizes after the configured depth.
 */
export async function smokePublicationMintAction({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, operator, restart, base }) {
  const token = `fictional-${randomUUID()}`;
  const kubo = await startFakeKubo(token);
  // A fresh wallet: earlier stages left history for the shared test wallet on other chains.
  const account = privateKeyToAccount(generatePrivateKey()), wallet = account.address.toLowerCase();
  let chain, relay;
  try {
    const actual = process.env.PUBLICATION_LOCAL_CHAIN === "1";
    if (actual) chain = await localMintChain(account);
    // Browser fixture only: the server reaches Anvil through a relay the helper can switch off (node outage).
    if (chain && browserStage("mint")) relay = await startRpcRelay(chain.url);
    const storage = { key: "fictional-mint", scope: "fictional-local-node", apiUrl: kubo.url, gatewayUrl: kubo.url, token };
    await restart(storage, { wallet, env: chain ? { HARTOLIT_MINT_RPC_URL: relay?.url ?? chain.url, HARTOLIT_MINT_CONTRACT_ADDRESS: chain.target.contractAddress,
      HARTOLIT_MINT_CONTRACT_CODE_HASH: chain.target.contractCodeHash, HARTOLIT_MINT_RECIPIENT_WALLET: chain.target.recipientWallet,
      HARTOLIT_MINT_CONFIRMATIONS: String(chain.target.requiredConfirmations) } : {} });
    const record = await preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account });
    assert.equal((await api(`${record.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: record.body })).status, 200);
    const mint = `${record.root}/mint`;
    // Browser fixture: the helper acts as the fresh test wallet (signs and sends on the owned Anvil only).
    if (chain && await browserCheckpoint("mint", { base, actors: { "/publisher": publisher }, label: record.id, handlers: {
      "/wallet": async () => ({ address: wallet }),
      // An optional gas limit lets a pass make the mint revert (out of gas).
      "/send": async tx => ({ hash: await chain.send({ request: { from: wallet, chainId: 97, to: tx.to, data: tx.data, nonce: Number(BigInt(tx.nonce)), value: "0" } },
        undefined, tx.gas ? BigInt(tx.gas) : undefined) }),
      "/outage": async ({ on }) => { relay.down = !!on; return { down: relay.down }; },
      // What the scheduler would do: one monitoring tick for this record's attempt.
      "/monitor": async () => {
        const state = (await (await api(`${record.root}/mint`, { user: publisher })).json()).mint;
        const response = await api(`${record.root}/mint/check`, { user: publisher, method: "POST", body: { attemptId: state.attempt.id } });
        return { status: response.status, check: (await response.json()).check ?? null };
      },
      "/rpc": async ({ method, params }) => ({ result: await chain.reader.request({ method, params }) }),
      "/mine": async () => { await chain.reader.request({ method: "anvil_mine", params: [`0x${chain.target.requiredConfirmations.toString(16)}`] }); return { ok: true }; },
    } })) stopAfterBrowserStage("mint");
    const overview = async (user = publisher) => { const response = await api(mint, { user }); assert.equal(response.status, 200); return (await response.json()).mint; };
    const post = (path, body, user = publisher) => api(`${mint}/${path}`, { user, method: "POST", body });
    for (const [actor, status] of [[null, 401], [operator, 403]]) assert.equal((await api(mint, { user: actor })).status, status);

    // The scheduler command (D69): JSON counts only; exit 2 without chain configuration.
    const monitor = (args, env = {}) => {
      const result = spawnSync(process.execPath, ["scripts/publication-monitor.mjs", ...args], { env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true });
      const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
      const attention = output.quarantined > 0 || output.pinUnknown > 0 || output.overdue > 0 || (output.batch?.statuses?.BLOCKED ?? 0) > 0 || (output.batch?.statuses?.UNAVAILABLE ?? 0) > 0;
      return { status: result.status, output, attention };
    };
    const summary = monitor([]);
    assert.equal(summary.output.mode, "summary"); assert.equal(typeof summary.output.attempts, "object"); assert.equal(summary.status, summary.attention ? 1 : 0);
    assert.ok(!JSON.stringify(summary.output).includes(record.publicationId), "the monitor prints no identifiers");
    if (!chain) {
      const unconfigured = monitor(["--run"]);
      assert.equal(unconfigured.status, 2); assert.match(unconfigured.output.error, /not configured/);
      const state = await overview();
      assert.equal(state.configured, false); assert.equal(state.candidate, null); assert.equal(state.publication.status, "PINNED");
      assert.equal((await post("dispatch", { preparationId: randomUUID(), requestId: randomUUID(), expectedIntentSha256: "0".repeat(64), acknowledgement: "SEND_EXACT_MINT" })).status, 503);
      assert.equal((await post("report", { attemptId: randomUUID(), transactionHash: `0x${"a".repeat(64)}` })).status, 503);
      process.stdout.write("Mint action passed (unconfigured): no candidate, no send permission, no report without server chain configuration.\n");
      return;
    }

    const state = await overview();
    assert.equal(state.configured, true);
    assert.equal(state.candidate.intent.contractAddress, chain.target.contractAddress);
    assert.equal(state.candidate.request.from, wallet); assert.equal(state.candidate.request.value, "0");
    assert.equal((await overview(other)).candidate.intent.sha256, state.candidate.intent.sha256, "other admins can review the same intent");
    // An earlier record proved for another wallet is explained, never offered.
    const stale = await db.publication.findFirst({ where: { status: "PINNED", publisherWallet: { not: wallet }, passport: { ownerId } }, select: { passportId: true } });
    assert.ok(stale, "an earlier stage left a record pinned for the shared test wallet");
    const staleState = (await (await api(`/api/admin/passports/${stale.passportId}/publication/mint`, { user: publisher })).json()).mint;
    assert.equal(staleState.walletChanged, true); assert.equal(staleState.candidate, null, "no mint is offered for another wallet's reservation");
    const preparation = { publicationId: record.publicationId, requestId: randomUUID(), confirmationId: record.confirmationId, passportVersion: 4,
      expectedSha256: record.payloadHash, expectedIntentSha256: state.candidate.intent.sha256, acknowledgement: "PREPARE_EXACT_MINT" };
    assert.equal((await post("preparation", preparation, other)).status, 403, "only the designated publisher prepares");
    assert.equal((await post("preparation", { ...preparation, acknowledgement: "SEND_EXACT_MINT" })).status, 422);
    assert.equal((await post("preparation", { ...preparation, expectedIntentSha256: "0".repeat(64) })).status, 409);
    const prepared = await post("preparation", preparation);
    assert.equal(prepared.status, 201);
    const preparationId = (await prepared.json()).preparation.id;
    const saved = await overview();
    assert.equal(saved.candidate, null); assert.equal(saved.preparation.id, preparationId);

    const dispatch = { preparationId, requestId: randomUUID(), expectedIntentSha256: state.candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" };
    assert.equal((await post("dispatch", dispatch, other)).status, 403, "only the designated publisher receives send permission");
    assert.equal((await post("dispatch", { ...dispatch, acknowledgement: "PREPARE_EXACT_MINT" })).status, 422);
    const permitted = await post("dispatch", dispatch);
    assert.equal(permitted.status, 201);
    const command = (await permitted.json()).command;
    assert.equal(command.request.to, chain.target.contractAddress); assert.equal(command.request.nonce, await chain.reader.getTransactionCount({ address: account.address }), "the permission uses the wallet's current idle nonce");
    assert.equal(command.issued, false); assert.equal(command.canResend, false);
    assert.equal((await post("dispatch", { ...dispatch, requestId: randomUUID() })).status, 409, "one permission per wallet slot");
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: record.publicationId } })).status, "CHAIN_PENDING");

    // The browser wallet would send exactly this request; the server never signs.
    const hash = await chain.send(command);
    const report = await post("report", { attemptId: command.attemptId, transactionHash: hash });
    assert.equal(report.status, 200);
    // Discovery would find the send anyway; the report itself must be on record.
    assert.equal(await db.publicationMintObservation.count({ where: { attemptId: command.attemptId, reportedHash: hash } }), 1, "the reported hash is recorded");
    assert.equal((await post("report", { attemptId: command.attemptId, transactionHash: hash.toUpperCase().replace("0X", "0x") })).status, 400, "hashes are strict lowercase");
    await chain.reader.request({ method: "anvil_mine", params: [`0x${chain.target.requiredConfirmations.toString(16)}`] });
    // The first check after the configured depth finalizes, as the publisher would see it.
    const response = await post("check", { attemptId: command.attemptId });
    assert.equal(response.status, 200);
    const checked = (await response.json()).check;
    const published = await db.publication.findUniqueOrThrow({ where: { id: record.publicationId } });
    assert.equal(published.status, "PUBLISHED", `the first check finalized the mint (${checked.status})`);
    assert.equal(published.transactionHash, hash); assert.equal(published.contractAddress, chain.target.contractAddress); assert.ok(published.tokenId);
    const final = await overview();
    assert.equal(final.attempt.status, "FINALIZED"); assert.deepEqual(final.attempt.transactionHashes, [hash]);
    const issued = (await (await api(record.root, { user: publisher })).json()).reservations.find(row => row.id === record.publicationId).issued;
    assert.equal(issued.tokenId, published.tokenId, "the admin view shows the issued token");
    const mintEnv = { HARTOLIT_MINT_RPC_URL: chain.url, HARTOLIT_MINT_CONTRACT_ADDRESS: chain.target.contractAddress, HARTOLIT_MINT_CONTRACT_CODE_HASH: chain.target.contractCodeHash,
      HARTOLIT_MINT_RECIPIENT_WALLET: chain.target.recipientWallet, HARTOLIT_MINT_CONFIRMATIONS: String(chain.target.requiredConfirmations), HARTOLIT_PUBLISHER_WALLET: wallet };
    const ran = monitor(["--run", "--limit", "5"], mintEnv);
    assert.equal(ran.output.mode, "run"); assert.equal(typeof ran.output.batch.checked, "number"); assert.equal(ran.status, ran.attention ? 1 : 0);
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: record.publicationId } })).status, "PUBLISHED", "monitoring never undoes a finalized record");

    // The publisher refuses in the wallet after permission: a same-nonce self-send and the
    // reviewed closure (D46/D48 over HTTP) free the wallet; the record stays unissued.
    const refused = await preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account });
    assert.equal((await api(`${refused.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: refused.body })).status, 200);
    const refusedMint = `${refused.root}/mint`;
    const refusedState = async () => (await (await api(refusedMint, { user: publisher })).json()).mint;
    const candidate = (await refusedState()).candidate;
    const refusedPrepared = await api(`${refusedMint}/preparation`, { user: publisher, method: "POST", body: { publicationId: refused.publicationId, requestId: randomUUID(),
      confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, expectedIntentSha256: candidate.intent.sha256, acknowledgement: "PREPARE_EXACT_MINT" } });
    assert.equal(refusedPrepared.status, 201);
    const refusedCommand = (await (await api(`${refusedMint}/dispatch`, { user: publisher, method: "POST", body: { preparationId: (await refusedPrepared.json()).preparation.id,
      requestId: randomUUID(), expectedIntentSha256: candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" } })).json()).command;
    const cancellation = (query, user = publisher) => api(`${refusedMint}/cancellation?${new URLSearchParams(query)}`, { user });
    assert.equal((await cancellation({ attemptId: refusedCommand.attemptId, discoveryId: randomUUID() })).status, 409, "no closure review without a found conflict");
    await chain.cancel(refusedCommand);
    const found = await api(`${refusedMint}/check`, { user: publisher, method: "POST", body: { attemptId: refusedCommand.attemptId } });
    assert.equal((await found.json()).check.status, "CONFLICT", "the check finds the same-nonce self-send");
    const conflictState = await refusedState();
    assert.equal(conflictState.attempt.latestDiscovery.status, "CONFLICT"); assert.equal(conflictState.attempt.status, "DISPATCHING");
    const target = { attemptId: refusedCommand.attemptId, discoveryId: conflictState.attempt.latestDiscovery.id };
    assert.equal((await cancellation(target, other)).status, 403, "only the designated publisher reviews the closure");
    const reviewed = (await (await cancellation(target)).json()).review;
    assert.equal(reviewed.nonce, String(refusedCommand.request.nonce)); assert.equal(reviewed.transactionHash, conflictState.attempt.latestDiscovery.transactionHash);
    const closure = { attemptId: refusedCommand.attemptId, requestId: randomUUID(), discoveryId: reviewed.discoveryId, expectedIntentSha256: reviewed.intentSha256,
      expectedWalletStateSha256: reviewed.walletStateSha256, expectedObservationVersion: reviewed.observationVersion, expectedDiscoveryVersion: reviewed.discoveryVersion,
      acknowledgement: "CLOSE_CANCELLED_MINT" };
    const close = (body, user = publisher) => api(`${refusedMint}/cancellation`, { user, method: "POST", body });
    assert.equal((await close({ ...closure, acknowledgement: "SEND_EXACT_MINT" })).status, 422);
    assert.equal((await close(closure, other)).status, 403);
    assert.equal((await close(closure)).status, 409, "a cancellation below the configured depth does not release the slot");
    await chain.reader.request({ method: "anvil_mine", params: [`0x${chain.target.requiredConfirmations.toString(16)}`] });
    const closingBody = { ...closure, requestId: randomUUID() };
    const closed = await close(closingBody);
    assert.equal(closed.status, 200, `closure after depth (${closed.status})`);
    const recordedClosure = (await closed.json()).cancellation;
    assert.equal(recordedClosure.status, "RECORDED"); assert.equal(recordedClosure.issued, false); assert.equal(recordedClosure.canResend, false);
    assert.equal((await (await close(closingBody)).json()).cancellation.cancellationId, recordedClosure.cancellationId, "the same request is idempotent");
    const closedState = await refusedState();
    assert.equal(closedState.attempt.status, "FAILED_TERMINAL"); assert.equal(closedState.attempt.failureStatus, "CANCELLED");
    assert.equal(closedState.publication.status, "CHAIN_FAILED", "the record stays unissued");
    assert.equal(await db.publicationMintAttempt.count({ where: { publisherWallet: wallet, status: { in: ["DISPATCHING", "UNKNOWN"] } } }), 0, "no open attempt holds the wallet");
    const refusedRow = await db.publication.findUniqueOrThrow({ where: { id: refused.publicationId } });
    assert.equal(refusedRow.tokenId, null); assert.equal(refusedRow.transactionHash, null);

    // Incident panel routes (D43-D45, D49, D50 over HTTP). A mint that runs out of gas is
    // included but reverted: the reviewed closure frees the wallet (D44).
    const incident = (root, attemptId, user = publisher) => api(`${root}/mint/incident?attemptId=${attemptId}`, { user });
    const resolve = (root, body, user = publisher) => api(`${root}/mint/incident`, { user, method: "POST", body });
    assert.equal((await incident(record.root, command.attemptId)).status, 409, "a healthy finalized mint has no incident");
    const failing = await preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account });
    assert.equal((await api(`${failing.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: failing.body })).status, 200);
    const failingIntent = (await (await api(`${failing.root}/mint`, { user: publisher })).json()).mint.candidate.intent.sha256;
    const failingPrepared = await api(`${failing.root}/mint/preparation`, { user: publisher, method: "POST", body: { publicationId: failing.publicationId, requestId: randomUUID(),
      confirmationId: failing.confirmationId, passportVersion: 4, expectedSha256: failing.payloadHash, expectedIntentSha256: failingIntent, acknowledgement: "PREPARE_EXACT_MINT" } });
    const failingCommand = (await (await api(`${failing.root}/mint/dispatch`, { user: publisher, method: "POST", body: { preparationId: (await failingPrepared.json()).preparation.id,
      requestId: randomUUID(), expectedIntentSha256: failingIntent, acknowledgement: "SEND_EXACT_MINT" } })).json()).command;
    const revertedHash = await chain.send(failingCommand, undefined, 35_000n);
    assert.equal((await chain.reader.waitForTransactionReceipt({ hash: revertedHash })).status, "reverted", "the send runs out of execution gas");
    assert.equal((await api(`${failing.root}/mint/report`, { user: publisher, method: "POST", body: { attemptId: failingCommand.attemptId, transactionHash: revertedHash } })).status, 200);
    await chain.reader.request({ method: "anvil_mine", params: [`0x${chain.target.requiredConfirmations.toString(16)}`] });
    await api(`${failing.root}/mint/check`, { user: publisher, method: "POST", body: { attemptId: failingCommand.attemptId } });
    const revertedState = (await (await api(`${failing.root}/mint`, { user: publisher })).json()).mint;
    assert.equal(revertedState.attempt.lastObservation, "REVERTED"); assert.equal(revertedState.attempt.status, "DISPATCHING", "a revert waits for review");
    assert.equal((await incident(failing.root, failingCommand.attemptId, other)).status, 403, "only the designated publisher reviews incidents");
    const reverted = (await (await incident(failing.root, failingCommand.attemptId)).json()).incident;
    assert.equal(reverted.kind, "REVERTED"); assert.equal(reverted.review.transactionHash, revertedHash);
    const closeReverted = { attemptId: failingCommand.attemptId, action: "CLOSE_REVERTED", requestId: randomUUID(), transactionId: reverted.review.transactionId,
      expectedIntentSha256: reverted.review.intentSha256, expectedWalletStateSha256: reverted.review.walletStateSha256,
      expectedObservationVersion: reverted.review.observationVersion, acknowledgement: "CLOSE_REVERTED_MINT" };
    assert.equal((await resolve(failing.root, { ...closeReverted, action: "RESTORE" })).status, 409, "the action must match the incident");
    assert.equal((await resolve(failing.root, { ...closeReverted, acknowledgement: "RESTORE_FAILED_MINT" })).status, 422);
    assert.equal((await resolve(failing.root, closeReverted, other)).status, 403);
    assert.equal((await resolve(failing.root, closeReverted)).status, 200, "the reverted send is closed");
    const failedState = (await (await api(`${failing.root}/mint`, { user: publisher })).json()).mint;
    assert.equal(failedState.attempt.status, "FAILED_TERMINAL"); assert.equal(failedState.attempt.failureStatus, "REVERTED"); assert.equal(failedState.publication.status, "CHAIN_FAILED");

    // A node outage during later checks quarantines the three closed attempts (success, revert,
    // cancellation); with the node back, each unchanged result is restored after review.
    const chainEnv = { HARTOLIT_MINT_RPC_URL: chain.url, HARTOLIT_MINT_CONTRACT_ADDRESS: chain.target.contractAddress, HARTOLIT_MINT_CONTRACT_CODE_HASH: chain.target.contractCodeHash,
      HARTOLIT_MINT_RECIPIENT_WALLET: chain.target.recipientWallet, HARTOLIT_MINT_CONFIRMATIONS: String(chain.target.requiredConfirmations) };
    const closedAttempts = [[record, command.attemptId, "SUCCESS", "PUBLISHED"], [failing, failingCommand.attemptId, "FAILURE", "CHAIN_FAILED"], [refused, refusedCommand.attemptId, "CANCELLATION", "CHAIN_FAILED"]];
    await new Promise(resolveWait => setTimeout(resolveWait, 31_000)); // monitoring cooldown after the last checks
    await restart(storage, { wallet, env: { ...chainEnv, HARTOLIT_MINT_RPC_URL: "http://127.0.0.1:9" } });
    for (const [row, attemptId] of closedAttempts) {
      const outage = await api(`${row.root}/mint/check`, { user: publisher, method: "POST", body: { attemptId } });
      assert.equal((await outage.json()).check.status, "UNAVAILABLE");
      assert.equal((await (await api(`${row.root}/mint`, { user: publisher })).json()).mint.attempt.quarantined, true, "an unconfirmed closed result is quarantined");
    }
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: record.publicationId } })).status, "CHAIN_SUSPENDED", "the issued record is suspended");
    assert.equal((await api(refused.root, { user: publisher, method: "POST", body: { confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, walletAddress: wallet } })).status, 409,
      "a quarantined failed publication blocks publishing the record again");
    await restart(storage, { wallet, env: chainEnv });
    for (const [row, attemptId, closed, restoredStatus] of closedAttempts) {
      const review = (await (await incident(row.root, attemptId)).json()).incident;
      assert.equal(review.kind, "QUARANTINE"); assert.equal(review.closed, closed);
      const r = review.restore, common = { attemptId, action: "RESTORE", requestId: randomUUID(), expectedIntentSha256: r.intentSha256,
        expectedWalletStateSha256: r.walletStateSha256, expectedObservationVersion: r.observationVersion, expectedQuarantinedAt: r.quarantinedAt };
      if (review.reanchor) {
        const a = review.reanchor;
        const reanchor = await resolve(row.root, { attemptId, action: "REANCHOR", requestId: randomUUID(), expectedIntentSha256: a.intentSha256, expectedWalletStateSha256: a.walletStateSha256,
          expectedObservationVersion: a.observationVersion, expectedQuarantinedAt: a.quarantinedAt, expectedFirstObservationId: a.firstObservationId,
          expectedAnchorObservationId: a.anchorObservationId, acknowledgement: "ADOPT_REINCLUDED_MINT_ANCHOR" });
        assert.equal(reanchor.status, 409, `${closed}: an unchanged inclusion is not a new anchor`);
      }
      const body = closed === "SUCCESS" ? { ...common, expectedFinalizedObservationId: r.finalizedObservationId, acknowledgement: "RESTORE_ORIGINAL_MINT" }
        : closed === "FAILURE" ? { ...common, expectedFailedObservationId: r.failedObservationId, acknowledgement: "RESTORE_FAILED_MINT" }
          : { ...common, expectedCancelledObservationId: r.cancelledObservationId, expectedCancellationId: r.cancellationId, acknowledgement: "RESTORE_CANCELLED_MINT" };
      assert.equal((await resolve(row.root, body, other)).status, 403);
      const restored = await resolve(row.root, body);
      assert.equal(restored.status, 200, `${closed}: unchanged result restored (${restored.status})`);
      const after = (await (await api(`${row.root}/mint`, { user: publisher })).json()).mint;
      assert.equal(after.attempt.quarantined, false); assert.equal(after.publication.status, restoredStatus);
    }

    // Published again (decision of 2026-10-26): the cancelled record's same confirmed snapshot gets a
    // new publication with a fresh wallet proof, upload consent and a higher nonce; the failed one stays.
    const again = await api(refused.root, { user: publisher, method: "POST", body: { confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, walletAddress: wallet } });
    assert.equal(again.status, 201, `a record whose mint was cancelled can be published again (${again.status === 201 ? "" : await again.clone().text()})`);
    const againId = (await again.json()).reservation.id;
    assert.notEqual(againId, refused.publicationId);
    const repeated = await api(refused.root, { user: publisher, method: "POST", body: { confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, walletAddress: wallet } });
    assert.equal(repeated.status, 200); assert.equal((await repeated.json()).reservation.id, againId, "the new reservation is idempotent");
    assert.equal((await api(refused.root, { user: other, method: "POST", body: { confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, walletAddress: wallet } })).status, 403, "only the designated publisher publishes again");
    const againChallenge = (await (await api(`${refused.root}/wallet-challenge`, { user: publisher, method: "POST", body: { publicationId: againId } })).json()).challenge;
    assert.equal((await api(`${refused.root}/wallet-proof`, { user: publisher, method: "POST", body: { publicationId: againId, challengeId: againChallenge.id,
      signature: await account.signMessage({ message: againChallenge.message }) } })).status, 200);
    const againTarget = (await (await api(refused.root, { user: publisher })).json()).pinning.target.configurationSha256;
    const againConsent = await api(`${refused.root}/pin-attempts`, { user: publisher, method: "POST", body: { publicationId: againId, requestId: randomUUID(),
      confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, expectedTargetSha256: againTarget, acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" } });
    assert.equal(againConsent.status, 201);
    assert.equal((await api(`${refused.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: { publicationId: againId,
      attemptId: (await againConsent.json()).attempt.id, expectedTargetSha256: againTarget, acknowledgement: "UPLOAD_PREPARED_SNAPSHOT" } })).status, 200, "the same bytes upload again");
    const againState = (await (await api(refusedMint, { user: publisher })).json()).mint;
    assert.equal(againState.publication.id, againId, "the mint panel follows the new publication");
    const againPrepared = await api(`${refusedMint}/preparation`, { user: publisher, method: "POST", body: { publicationId: againId, requestId: randomUUID(),
      confirmationId: refused.confirmationId, passportVersion: 4, expectedSha256: refused.payloadHash, expectedIntentSha256: againState.candidate.intent.sha256, acknowledgement: "PREPARE_EXACT_MINT" } });
    assert.equal(againPrepared.status, 201);
    const againCommand = (await (await api(`${refusedMint}/dispatch`, { user: publisher, method: "POST", body: { preparationId: (await againPrepared.json()).preparation.id,
      requestId: randomUUID(), expectedIntentSha256: againState.candidate.intent.sha256, acknowledgement: "SEND_EXACT_MINT" } })).json()).command;
    assert.ok(againCommand.request.nonce > refusedCommand.request.nonce, "a higher nonce; the cancelled one stays claimed");
    const againHash = await chain.send(againCommand);
    assert.equal((await api(`${refusedMint}/report`, { user: publisher, method: "POST", body: { attemptId: againCommand.attemptId, transactionHash: againHash } })).status, 200);
    await chain.reader.request({ method: "anvil_mine", params: [`0x${chain.target.requiredConfirmations.toString(16)}`] });
    await api(`${refusedMint}/check`, { user: publisher, method: "POST", body: { attemptId: againCommand.attemptId } });
    const [oldRow, newRow] = await Promise.all([db.publication.findUniqueOrThrow({ where: { id: refused.publicationId } }), db.publication.findUniqueOrThrow({ where: { id: againId } })]);
    assert.equal(newRow.status, "PUBLISHED", "the record is issued on the second publication"); assert.ok(newRow.tokenId);
    assert.equal(oldRow.status, "CHAIN_FAILED"); assert.equal(oldRow.tokenId, null, "the failed publication stays as unissued history");
    assert.equal(newRow.payloadHash, oldRow.payloadHash); assert.equal(newRow.ipfsCid, oldRow.ipfsCid, "same snapshot, same CID");
    // The database itself allows only one publication per confirmation that did not fail
    // (the partial index; ON CONFLICT names it, so a missing index makes the query fail).
    const duplicate = await db.$queryRaw`
      INSERT INTO "Publication" ("id", "passportId", "confirmationId", "reservedById", "publisherWallet", "passportVersion", "approvedVersion", "status",
        "idempotencyKey", "canonicalJson", "payloadHash", "chainId", "updatedAt")
      SELECT gen_random_uuid(), "passportId", "confirmationId", "reservedById", "publisherWallet", "passportVersion", "approvedVersion", 'RESERVED',
        ${`fictional-duplicate-${randomUUID()}`}, "canonicalJson", "payloadHash", 97, now() FROM "Publication" WHERE "id" = ${againId}::uuid
      ON CONFLICT ("confirmationId") WHERE "status" NOT IN ('CHAIN_FAILED', 'CHAIN_FAILED_SUSPENDED') DO NOTHING RETURNING "id"`;
    assert.equal(duplicate.length, 0, "a second open publication of the same confirmation is refused by SQL");
    process.stdout.write("Mint action passed: reviewed intent, designated-publisher preparation and single fixed-nonce permission, exact wallet request, hash report and depth-checked finalization on actual Anvil; a refused send is cancelled by a same-nonce self-send and closed over HTTP after depth, freeing the wallet; an out-of-gas mint is closed and a node-outage quarantine of success, revert and cancellation is restored through the incident route; the cancelled record is published again and issued.\n");
  } finally {
    await relay?.close();
    await chain?.stop();
    await kubo.close();
  }
}

// Test-only JSON-RPC relay on loopback; while `down` it answers 503 like an unavailable node.
async function startRpcRelay(target) {
  const relay = { down: false };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (relay.down) { res.writeHead(503); res.end(); return; }
    try {
      const upstream = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
      res.writeHead(upstream.status, { "content-type": "application/json" }); res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { res.writeHead(502); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  relay.url = `http://127.0.0.1:${server.address().port}`;
  relay.close = () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
  return relay;
}
