import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { localMintChain } from "./local-mint-chain.mjs";
import { preparePinRecord, startFakeKubo } from "./smoke-publication-upload-action.mjs";

/** D68: mint routes. Without mint configuration nothing is offered or authorized.
 * With an owned Anvil (PUBLICATION_LOCAL_CHAIN=1) a fresh publisher wallet prepares,
 * receives one fixed-nonce permission, sends the exact request as the browser wallet
 * would, reports the hash, and a monitoring check finalizes after the configured depth.
 */
export async function smokePublicationMintAction({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, operator, restart }) {
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
    const overview = async (user = publisher) => { const response = await api(mint, { user }); assert.equal(response.status, 200); return (await response.json()).mint; };
    const post = (path, body, user = publisher) => api(`${mint}/${path}`, { user, method: "POST", body });
    for (const [actor, status] of [[null, 401], [operator, 403]]) assert.equal((await api(mint, { user: actor })).status, status);

    if (!chain) {
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
    process.stdout.write("Mint action passed: reviewed intent, designated-publisher preparation and single fixed-nonce permission, exact wallet request, hash report and depth-checked finalization on actual Anvil.\n");
  } finally {
    await chain?.stop();
    await kubo.close();
  }
}
