import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { localMintChain } from "./local-mint-chain.mjs";
import { preparePinRecord, startFakeKubo } from "./smoke-publication-upload-action.mjs";
import { browserCheckpoint, stopAfterBrowserStage } from "./publication-browser-checkpoint.mjs";

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
  let chain;
  try {
    const actual = process.env.PUBLICATION_LOCAL_CHAIN === "1";
    if (actual) chain = await localMintChain(account);
    const storage = { key: "fictional-mint", scope: "fictional-local-node", apiUrl: kubo.url, gatewayUrl: kubo.url, token };
    await restart(storage, { wallet, env: chain ? { HARTOLIT_MINT_RPC_URL: chain.url, HARTOLIT_MINT_CONTRACT_ADDRESS: chain.target.contractAddress,
      HARTOLIT_MINT_CONTRACT_CODE_HASH: chain.target.contractCodeHash, HARTOLIT_MINT_RECIPIENT_WALLET: chain.target.recipientWallet,
      HARTOLIT_MINT_CONFIRMATIONS: String(chain.target.requiredConfirmations) } : {} });
    const record = await preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account });
    assert.equal((await api(`${record.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: record.body })).status, 200);
    const mint = `${record.root}/mint`;
    // Browser fixture: the helper acts as the fresh test wallet (signs and sends on the owned Anvil only).
    if (chain && await browserCheckpoint("mint", { base, actors: { "/publisher": publisher }, label: record.id, handlers: {
      "/wallet": async () => ({ address: wallet }),
      "/send": async tx => ({ hash: await chain.send({ request: { from: wallet, chainId: 97, to: tx.to, data: tx.data, nonce: Number(BigInt(tx.nonce)), value: "0" } }) }),
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
    process.stdout.write("Mint action passed: reviewed intent, designated-publisher preparation and single fixed-nonce permission, exact wallet request, hash report and depth-checked finalization on actual Anvil; a refused send is cancelled by a same-nonce self-send and closed over HTTP after depth, freeing the wallet.\n");
  } finally {
    await chain?.stop();
    await kubo.close();
  }
}
