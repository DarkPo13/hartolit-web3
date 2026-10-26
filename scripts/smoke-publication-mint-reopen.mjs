import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createWalletClient, defineChain, http, keccak256, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { localMintChain } from "./local-mint-chain.mjs";
import { preparePinRecord, startFakeKubo } from "./smoke-publication-upload-action.mjs";

/** D75 on an owned Anvil: real reorganizations make a recorded mint result stop holding.
 * Each incident class is proposed by the designated publisher and approved by a second MFA
 * admin through the incident route; the reopened attempt then resolves through the normal
 * check, D44/D48 closures and finalization. A second fictional minter creates the conflicts.
 */
export async function smokePublicationMintReopen({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, restart }) {
  const token = `fictional-${randomUUID()}`;
  const kubo = await startFakeKubo(token);
  const account = privateKeyToAccount(generatePrivateKey()), wallet = account.address.toLowerCase();
  const rival = privateKeyToAccount(generatePrivateKey());
  let chain;
  try {
    chain = await localMintChain(account);
    const evm = (method, params = []) => chain.reader.request({ method, params });
    const local = defineChain({ id: 97, name: "Fictional local BSC chain", nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: [chain.url] } } });
    const artifact = JSON.parse(await readFile("contracts/out/HartolitFieldPassport.sol/HartolitFieldPassport.json", "utf8"));
    const adminClient = createWalletClient({ account, chain: local, transport: http(chain.url) });
    const rivalClient = createWalletClient({ account: rival, chain: local, transport: http(chain.url) });
    await evm("anvil_setBalance", [rival.address, "0x56bc75e2d63100000"]);
    // A second fictional minter, granted before the app plans any nonce.
    await chain.reader.waitForTransactionReceipt({ hash: await adminClient.writeContract({ address: chain.target.contractAddress, abi: artifact.abi,
      functionName: "grantRole", args: [keccak256(toBytes("MINTER_ROLE")), rival.address] }) });
    const rivalMint = async (payloadHash, cid) => chain.reader.waitForTransactionReceipt({ hash: await rivalClient.writeContract({ address: chain.target.contractAddress,
      abi: artifact.abi, functionName: "mintPassport", args: [chain.target.recipientWallet, `0x${payloadHash}`, `ipfs://${cid}`], gas: 500_000n }) });
    const depth = chain.target.requiredConfirmations, mine = (blocks = depth) => evm("anvil_mine", [`0x${blocks.toString(16)}`]);
    const storage = { key: "fictional-reopen", scope: "fictional-local-node", apiUrl: kubo.url, gatewayUrl: kubo.url, token };
    await restart(storage, { wallet, env: { HARTOLIT_MINT_RPC_URL: chain.url, HARTOLIT_MINT_CONTRACT_ADDRESS: chain.target.contractAddress,
      HARTOLIT_MINT_CONTRACT_CODE_HASH: chain.target.contractCodeHash, HARTOLIT_MINT_RECIPIENT_WALLET: chain.target.recipientWallet,
      HARTOLIT_MINT_CONFIRMATIONS: String(depth) } });

    const record = async () => {
      const row = await preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account });
      assert.equal((await api(`${row.root}/pin-attempts/upload`, { user: publisher, method: "POST", body: row.body })).status, 200);
      const candidate = (await (await api(`${row.root}/mint`, { user: publisher })).json()).mint.candidate;
      const prepared = await api(`${row.root}/mint/preparation`, { user: publisher, method: "POST", body: { publicationId: row.publicationId, requestId: randomUUID(),
        confirmationId: row.confirmationId, passportVersion: 4, expectedSha256: row.payloadHash, expectedIntentSha256: candidate.intent.sha256, acknowledgement: "PREPARE_EXACT_MINT" } });
      assert.equal(prepared.status, 201);
      return { ...row, cid: candidate.intent.ipfsCid, intentSha256: candidate.intent.sha256, preparationId: (await prepared.json()).preparation.id };
    };
    const permit = async row => {
      const response = await api(`${row.root}/mint/dispatch`, { user: publisher, method: "POST", body: { preparationId: row.preparationId, requestId: randomUUID(),
        expectedIntentSha256: row.intentSha256, acknowledgement: "SEND_EXACT_MINT" } });
      assert.equal(response.status, 201, `permission (${response.status} ${await response.clone().text()})`);
      return (await response.json()).command;
    };
    // The 30-second monitoring cooldown is covered by the monitor smoke; here it only costs time.
    const check = async (row, attemptId) => {
      await db.$executeRaw`UPDATE "PublicationMintAttempt" SET "monitorNextAt" = now() WHERE "id" = ${attemptId}::uuid`;
      const response = await api(`${row.root}/mint/check`, { user: publisher, method: "POST", body: { attemptId } });
      assert.equal(response.status, 200); return (await response.json()).check.status;
    };
    // Discovery is paged; repeat while it only scanned part of the range.
    const search = async (row, attemptId) => {
      for (let page = 0; page < 20; page++) { const status = await check(row, attemptId); if (status !== "SCANNED") return status; }
      throw new Error("discovery did not catch up");
    };
    const state = async row => (await (await api(`${row.root}/mint`, { user: publisher })).json()).mint;
    const incident = async (row, attemptId, user = publisher) => api(`${row.root}/mint/incident?attemptId=${attemptId}`, { user });
    const act = (row, attemptId, action, body, user = publisher) => api(`${row.root}/mint/incident`, { user, method: "POST", body: { attemptId, action, ...body } });
    const propose = async (row, attemptId) => {
      const response = await act(row, attemptId, "PROPOSE_REOPEN", { requestId: randomUUID(), reason: "Fictional reorganization seen in the smoke test", acknowledgement: "PROPOSE_MINT_REOPEN" });
      assert.equal(response.status, 200, `proposal (${response.status} ${await response.clone().text()})`);
      return (await response.json()).resolution;
    };
    const approve = async (row, attemptId) => {
      const view = (await (await incident(row, attemptId, other)).json()).incident;
      assert.ok(view.proposal && !view.proposal.ownProposal, "the second admin sees the proposal");
      return act(row, attemptId, "APPROVE_REOPEN", { requestId: randomUUID(), proposalId: view.proposal.id, expectedKind: view.proposal.kind,
        expectedObservationVersion: view.proposal.observationVersion, acknowledgement: "APPROVE_MINT_REOPEN" }, other);
    };
    const backdate = attemptId => db.$executeRaw`UPDATE "PublicationMintReopen" SET "proposedAt" = now() - interval '25 hours' WHERE "attemptId" = ${attemptId}::uuid AND "status" = 'PROPOSED'`;
    const publicationOf = row => db.publication.findUniqueOrThrow({ where: { id: row.publicationId } });
    const issue = async (row, attemptId) => { await search(row, attemptId); assert.equal((await publicationOf(row)).status, "PUBLISHED", "the check finalizes at depth"); };

    // Class "different token ID": the same signed mint is re-included after another mint took its number.
    const first = await record(), firstCommand = await permit(first);
    const firstRaw = await chain.sign(firstCommand), branch1 = await evm("evm_snapshot");
    await evm("eth_sendRawTransaction", [firstRaw]); await mine();
    await issue(first, firstCommand.attemptId);
    const issued = await publicationOf(first);
    assert.equal(issued.status, "PUBLISHED");
    assert.equal(await evm("evm_revert", [branch1]), true);
    await rivalMint(randomBytes(32).toString("hex"), first.cid);
    await evm("eth_sendRawTransaction", [firstRaw]); await mine();
    await check(first, firstCommand.attemptId);
    assert.equal((await publicationOf(first)).status, "CHAIN_SUSPENDED", "a different token for the same transaction quarantines the record");
    const ownView = (await (await incident(first, firstCommand.attemptId)).json()).incident;
    assert.equal(ownView.kind, "QUARANTINE"); assert.equal(ownView.proposal, null);
    assert.equal((await act(first, firstCommand.attemptId, "PROPOSE_REOPEN", { requestId: randomUUID(), reason: "too short", acknowledgement: "PROPOSE_MINT_REOPEN" })).status, 422);
    assert.equal((await act(first, firstCommand.attemptId, "PROPOSE_REOPEN", { requestId: randomUUID(), reason: "Fictional reason from another admin", acknowledgement: "PROPOSE_MINT_REOPEN" }, other)).status, 403,
      "only the designated publisher proposes");
    assert.equal((await propose(first, firstCommand.attemptId)).kind, "TOKEN_CHANGED");
    assert.equal((await act(first, firstCommand.attemptId, "PROPOSE_REOPEN", { requestId: randomUUID(), reason: "Fictional second proposal", acknowledgement: "PROPOSE_MINT_REOPEN" })).status, 409, "one open proposal");
    const selfView = (await (await incident(first, firstCommand.attemptId)).json()).incident.proposal;
    assert.equal(selfView.ownProposal, true);
    assert.equal((await act(first, firstCommand.attemptId, "APPROVE_REOPEN", { requestId: randomUUID(), proposalId: selfView.id, expectedKind: "TOKEN_CHANGED",
      expectedObservationVersion: selfView.observationVersion, acknowledgement: "APPROVE_MINT_REOPEN" })).status, 403, "the proposer cannot approve");
    assert.equal((await act(first, firstCommand.attemptId, "APPROVE_REOPEN", { requestId: randomUUID(), proposalId: selfView.id, expectedKind: "LOST",
      expectedObservationVersion: selfView.observationVersion, acknowledgement: "APPROVE_MINT_REOPEN" }, other)).status, 409, "the approval names the proposed class");
    const approved = await approve(first, firstCommand.attemptId);
    assert.equal(approved.status, 200, `approval (${approved.status} ${await approved.clone().text()})`);
    const reopened = await state(first);
    assert.equal(reopened.attempt.status, "UNKNOWN"); assert.equal(reopened.attempt.reopened.kind, "TOKEN_CHANGED"); assert.equal(reopened.publication.status, "CHAIN_PENDING");
    await issue(first, firstCommand.attemptId);
    const reissued = await publicationOf(first);
    assert.equal(reissued.status, "PUBLISHED"); assert.notEqual(reissued.tokenId, issued.tokenId, "the record now has the new token");
    const overview = (await (await api(first.root, { user: publisher })).json()).reservations.find(row => row.id === first.publicationId);
    assert.deepEqual(overview.issued.previousTokenIds, [issued.tokenId], "the admin panel names the old number for reprinting");

    // Class "lost proof": the finalized mint vanishes; after the wait, reopen, same-nonce self-send, D48 closure.
    const lost = await record(), lostCommand = await permit(lost);
    const lostRaw = await chain.sign(lostCommand), branch2 = await evm("evm_snapshot");
    await evm("eth_sendRawTransaction", [lostRaw]); await mine();
    await issue(lost, lostCommand.attemptId);
    assert.equal(await evm("evm_revert", [branch2]), true); await mine();
    await check(lost, lostCommand.attemptId);
    assert.equal((await publicationOf(lost)).status, "CHAIN_SUSPENDED");
    assert.equal((await propose(lost, lostCommand.attemptId)).kind, "LOST");
    // Each wait is shown on its own: the blocks have passed here, only the 24 hours have not.
    await mine(10 * depth);
    const early = await approve(lost, lostCommand.attemptId);
    assert.equal(early.status, 409); assert.match((await early.json()).error, /24-hour/, "a lost proof waits 24 hours");
    await backdate(lostCommand.attemptId);
    assert.equal((await approve(lost, lostCommand.attemptId)).status, 200);
    assert.equal((await state(lost)).attempt.reopened.kind, "LOST");
    await chain.cancel(lostCommand); await mine();
    assert.equal(await search(lost, lostCommand.attemptId), "CONFLICT", "the same-nonce self-send is found");
    const conflict = (await state(lost)).attempt.latestDiscovery;
    const review = (await (await api(`${lost.root}/mint/cancellation?${new URLSearchParams({ attemptId: lostCommand.attemptId, discoveryId: conflict.id })}`, { user: publisher })).json()).review;
    const closed = await api(`${lost.root}/mint/cancellation`, { user: publisher, method: "POST", body: { attemptId: lostCommand.attemptId, requestId: randomUUID(),
      discoveryId: review.discoveryId, expectedIntentSha256: review.intentSha256, expectedWalletStateSha256: review.walletStateSha256,
      expectedObservationVersion: review.observationVersion, expectedDiscoveryVersion: review.discoveryVersion, acknowledgement: "CLOSE_CANCELLED_MINT" } });
    assert.equal(closed.status, 200, `cancellation closure (${closed.status} ${await closed.clone().text()})`);
    const lostRow = await publicationOf(lost);
    assert.equal(lostRow.status, "CHAIN_FAILED"); assert.equal(lostRow.tokenId, null, "the lost token is gone from the record; it can be published again (D74)");

    // Class "success became revert": the re-included mint now reverts (the rival minted the same document first).
    const reverted = await record(), revertedCommand = await permit(reverted);
    const revertedRaw = await chain.sign(revertedCommand), branch3 = await evm("evm_snapshot");
    await evm("eth_sendRawTransaction", [revertedRaw]); await mine();
    await issue(reverted, revertedCommand.attemptId);
    assert.equal(await evm("evm_revert", [branch3]), true);
    await rivalMint(reverted.payloadHash, reverted.cid);
    await evm("eth_sendRawTransaction", [revertedRaw]); await mine();
    await check(reverted, revertedCommand.attemptId);
    assert.equal((await publicationOf(reverted)).status, "CHAIN_SUSPENDED");
    assert.equal((await propose(reverted, revertedCommand.attemptId)).kind, "SUCCESS_REVERTED");
    // Here the 24 hours have passed but the blocks have not.
    await backdate(revertedCommand.attemptId);
    const shallow = await approve(reverted, revertedCommand.attemptId);
    assert.equal(shallow.status, 409); assert.match((await shallow.json()).error, /ten times the configured depth/, "and ten times the depth in blocks");
    await mine(10 * depth);
    assert.equal((await approve(reverted, revertedCommand.attemptId)).status, 200);
    await search(reverted, revertedCommand.attemptId);
    const revertedIncident = (await (await incident(reverted, revertedCommand.attemptId)).json()).incident;
    assert.equal(revertedIncident.kind, "REVERTED", "the reopened attempt shows the revert to close");
    const r = revertedIncident.review;
    assert.equal((await act(reverted, revertedCommand.attemptId, "CLOSE_REVERTED", { requestId: randomUUID(), transactionId: r.transactionId, expectedIntentSha256: r.intentSha256,
      expectedWalletStateSha256: r.walletStateSha256, expectedObservationVersion: r.observationVersion, acknowledgement: "CLOSE_REVERTED_MINT" })).status, 200);
    assert.equal((await publicationOf(reverted)).status, "CHAIN_FAILED");

    // Class "revert became success": a closed revert succeeds after the duplicate disappears.
    const revived = await record(), revivedCommand = await permit(revived);
    const branch4 = await evm("evm_snapshot");
    await rivalMint(revived.payloadHash, revived.cid);
    const revivedRaw = await chain.sign(revivedCommand);
    await evm("eth_sendRawTransaction", [revivedRaw]); await mine();
    await search(revived, revivedCommand.attemptId);
    const failedView = (await (await incident(revived, revivedCommand.attemptId)).json()).incident.review;
    assert.equal((await act(revived, revivedCommand.attemptId, "CLOSE_REVERTED", { requestId: randomUUID(), transactionId: failedView.transactionId,
      expectedIntentSha256: failedView.intentSha256, expectedWalletStateSha256: failedView.walletStateSha256, expectedObservationVersion: failedView.observationVersion,
      acknowledgement: "CLOSE_REVERTED_MINT" })).status, 200);
    assert.equal(await evm("evm_revert", [branch4]), true);
    await evm("eth_sendRawTransaction", [revivedRaw]); await mine();
    await check(revived, revivedCommand.attemptId);
    assert.equal((await publicationOf(revived)).status, "CHAIN_FAILED_SUSPENDED");
    assert.equal((await propose(revived, revivedCommand.attemptId)).kind, "FAILURE_SUCCEEDED");
    assert.equal((await approve(revived, revivedCommand.attemptId)).status, 200, "a positive change needs no wait");
    await issue(revived, revivedCommand.attemptId);
    assert.equal((await publicationOf(revived)).status, "PUBLISHED", "the reverted record is issued after all");
    assert.equal(await db.publicationMintFailure.count({ where: { attemptId: revivedCommand.attemptId } }), 1, "the earlier closure stays as history");

    // Class "changed dispatch anchor": the block the search starts from leaves the chain.
    const moved = await record();
    const branch5 = await evm("evm_snapshot"); await mine(1);
    const movedCommand = await permit(moved);
    const anchorBefore = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: movedCommand.attemptId } });
    assert.equal(await evm("evm_revert", [branch5]), true); await evm("evm_setNextBlockTimestamp", [`0x${(Math.floor(Date.now() / 1000) + 600).toString(16)}`]); await mine(2);
    assert.equal(await search(moved, movedCommand.attemptId), "REORG");
    assert.equal((await (await incident(moved, movedCommand.attemptId)).json()).incident.kind, "PENDING_REORG");
    assert.equal((await propose(moved, movedCommand.attemptId)).kind, "DISPATCH_ANCHOR_CHANGED");
    assert.equal((await approve(moved, movedCommand.attemptId)).status, 200);
    const anchorAfter = await db.publicationMintAttempt.findUniqueOrThrow({ where: { id: movedCommand.attemptId } });
    assert.ok(anchorAfter.dispatchBlockNumber < anchorBefore.dispatchBlockNumber, "the search starts from an earlier verified block");
    await chain.send(movedCommand); await mine();
    await issue(moved, movedCommand.attemptId);
    assert.equal((await publicationOf(moved)).status, "PUBLISHED");

    // Class "different transaction at the same nonce": no in-app resolution, only the runbook warning.
    const foreign = await record(), foreignCommand = await permit(foreign);
    await chain.reader.waitForTransactionReceipt({ hash: await adminClient.sendTransaction({ to: rival.address, value: 1n, nonce: foreignCommand.request.nonce }) });
    await mine();
    assert.equal(await search(foreign, foreignCommand.attemptId), "CONFLICT");
    const foreignView = (await (await incident(foreign, foreignCommand.attemptId)).json()).incident;
    assert.equal(foreignView.kind, "FOREIGN_NONCE"); assert.match(foreignView.transactionHash, /^0x[0-9a-f]{64}$/);
    assert.equal((await act(foreign, foreignCommand.attemptId, "PROPOSE_REOPEN", { requestId: randomUUID(), reason: "Fictional foreign nonce proposal", acknowledgement: "PROPOSE_MINT_REOPEN" })).status, 409,
      "a foreign transaction cannot be resolved in the app");
    assert.equal(await db.publicationMintReopen.count({ where: { attempt: { publisherWallet: wallet }, status: "APPLIED" } }), 5);
    process.stdout.write("Mint reopening passed: two-person reopening after real reorganizations (token changed, lost proof with wait and self-send, success became revert, revert became success), dispatch anchor moved to an earlier verified block, and a foreign transaction at the nonce flagged for the runbook.\n");
  } finally {
    await chain?.stop();
    await kubo.close();
  }
}
