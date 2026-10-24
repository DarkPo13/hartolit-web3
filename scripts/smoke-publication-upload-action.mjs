import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { browserCheckpoint, stopAfterBrowserStage } from "./publication-browser-checkpoint.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");

// Fictional Kubo-compatible node on loopback: RPC requires the configured bearer
// token; the gateway is anonymous. `mode` simulates a lost acknowledgement or a
// pin that is confirmed only later.
export async function startFakeKubo(token) {
  const blocks = new Map(), pinned = new Set(), requests = [];
  const state = { mode: "normal" };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push({ path: url.pathname, auth: req.headers.authorization ?? null });
    const json = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith("/api/v0/")) {
      if (req.headers.authorization !== `Bearer ${token}`) return json(401, { Message: "unauthorized" });
      if (url.pathname === "/api/v0/block/put") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const form = await new Request("http://127.0.0.1/", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: Buffer.concat(chunks) }).formData();
        const bytes = new Uint8Array(await form.get("file").arrayBuffer());
        const cid = rawCidFromSha256(createHash("sha256").update(bytes).digest("hex"));
        blocks.set(cid, bytes);
        if (state.mode !== "pin-later") pinned.add(cid);
        if (state.mode === "lost-ack") return json(500, { Message: "fictional lost acknowledgement" });
        return json(200, { Key: cid, Size: bytes.length });
      }
      if (url.pathname === "/api/v0/pin/ls") {
        const cid = url.searchParams.get("arg");
        return json(200, { Keys: pinned.has(cid) ? { [cid]: { Type: "recursive" } } : {} });
      }
      return json(404, {});
    }
    const block = url.pathname.match(/^\/ipfs\/([a-z0-9]+)$/)?.[1];
    if (block && blocks.has(block)) { res.writeHead(200, { "content-type": "application/vnd.ipld.raw" }); return res.end(blocks.get(block)); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, blocks, pinned, requests, state,
    close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

/** A fixture record consented and ready to send to the configured target (shared with the mint smoke). */
export async function preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account }) {
  const row = await fixture(ownerId, publisherId), id = row.passport.id;
  const confirmation = await confirm(publisher, row);
  const root = `/api/admin/passports/${id}/publication`;
  const reserved = await api(root, { user: publisher, method: "POST", body: { confirmationId: confirmation.id, passportVersion: 4,
    expectedSha256: confirmation.preview.sha256, walletAddress: account.address.toLowerCase() } });
  assert.equal(reserved.status, 201);
  const publicationId = (await reserved.json()).reservation.id;
  const challenge = (await (await api(`${root}/wallet-challenge`, { user: publisher, method: "POST", body: { publicationId } })).json()).challenge;
  assert.equal((await api(`${root}/wallet-proof`, { user: publisher, method: "POST", body: { publicationId, challengeId: challenge.id,
    signature: await account.signMessage({ message: challenge.message }) } })).status, 200);
  const overview = await (await api(root, { user: publisher })).json();
  assert.equal(overview.pinning.dispatchEnabled, true, "a configured target with its credential enables upload");
  const targetSha256 = overview.pinning.target.configurationSha256;
  const consent = await api(`${root}/pin-attempts`, { user: publisher, method: "POST", body: { publicationId, requestId: randomUUID(),
    confirmationId: confirmation.id, passportVersion: 4, expectedSha256: confirmation.preview.sha256, expectedTargetSha256: targetSha256,
    acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" } });
  assert.equal(consent.status, 201);
  const attemptId = (await consent.json()).attempt.id;
  const body = { publicationId, attemptId, expectedTargetSha256: targetSha256, acknowledgement: "UPLOAD_PREPARED_SNAPSHOT" };
  return { id, root, publicationId, attemptId, body, confirmationId: confirmation.id, canonicalJson: confirmation.preview.canonicalJson, payloadHash: confirmation.preview.sha256 };
}

/** D67: the designated publisher sends a prepared snapshot through the HTTP route to
 * the server-configured target; lost acknowledgements and late pins resolve by readback.
 */
export async function smokePublicationUploadAction({ api, db, fixture, confirm, ownerId, publisherId, publisher, other, operator, signingAccount, restart, base }) {
  const token = `fictional-${randomUUID()}`;
  const kubo = await startFakeKubo(token);
  try {
    await restart({ key: "fictional-upload", scope: "fictional-local-node", apiUrl: kubo.url, gatewayUrl: kubo.url, token });
    const prepared = () => preparePinRecord({ api, fixture, confirm, ownerId, publisherId, publisher, account: signingAccount });
    const upload = (record, patch = {}, user = publisher, origin) => api(`${record.root}/pin-attempts/upload`, { user, method: "POST", origin, body: { ...record.body, ...patch } });
    const readback = (record, user = publisher) => api(`${record.root}/pin-attempts/readback`, { user, method: "POST", body: { publicationId: record.publicationId, attemptId: record.attemptId } });
    const stored = async record => ({ attempt: await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: record.attemptId } }),
      publication: await db.publication.findUniqueOrThrow({ where: { id: record.publicationId } }) });

    // Refusals before anything is sent. `null` is an anonymous caller (undefined would mean the publisher default).
    const a = await prepared();
    if (await browserCheckpoint("upload", { base, actors: { "/publisher": publisher }, label: a.id })) stopAfterBrowserStage("upload");
    for (const [actor, status] of [[null, 401], [operator, 403], [other, 403]]) assert.equal((await upload(a, {}, actor)).status, status);
    assert.equal((await upload(a, {}, publisher, "https://evil.invalid")).status, 403);
    for (const patch of [{ acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" }, { acknowledgement: undefined }, { canonicalJson: "{}" }]) assert.equal((await upload(a, patch)).status, 400);
    assert.equal((await upload(a, { expectedTargetSha256: "0".repeat(64) })).status, 409, "a changed target is refused");
    assert.equal(kubo.blocks.size, 0, "nothing was sent by refused requests");
    assert.equal((await stored(a)).attempt.status, "PREPARED");

    // Success: exact bytes, credential on RPC only, single use.
    const sent = await upload(a);
    assert.equal(sent.status, 200);
    const cid = rawCidFromSha256(a.payloadHash);
    assert.deepEqual((await sent.json()).result, { status: "PINNED", cid, verifiedAt: (await stored(a)).attempt.verifiedAt.toISOString(), issued: false });
    assert.equal(Buffer.from(kubo.blocks.get(cid)).toString("utf8"), a.canonicalJson, "the node received exactly the confirmed public JSON");
    const after = await stored(a);
    assert.equal(after.attempt.status, "VERIFIED"); assert.equal(after.publication.status, "PINNED"); assert.equal(after.publication.ipfsCid, cid);
    assert.ok(kubo.requests.filter(r => r.path.startsWith("/api/v0/")).every(r => r.auth === `Bearer ${token}`), "RPC calls carry the server credential");
    assert.ok(kubo.requests.filter(r => r.path.startsWith("/ipfs/")).every(r => r.auth === null), "gateway reads carry no credential");
    const puts = () => kubo.requests.filter(r => r.path === "/api/v0/block/put").length;
    const putsBefore = puts();
    assert.equal((await upload(a)).status, 409, "an attempt is sent once");
    assert.equal(puts(), putsBefore, "a repeated upload sends nothing");
    assert.equal((await (await readback(a)).json()).result.status, "PINNED", "readback of a verified attempt is idempotent");

    // Lost acknowledgement: the node stored the block but the response failed.
    const b = await prepared();
    kubo.state.mode = "lost-ack";
    const lost = await upload(b);
    assert.equal(lost.status, 200);
    assert.equal((await lost.json()).result.status, "PINNED", "readback finds a write whose acknowledgement was lost");
    assert.equal((await stored(b)).attempt.status, "VERIFIED");

    // Pin confirmed later: UNKNOWN, no resend, then readback by any MFA admin.
    const c = await prepared();
    kubo.state.mode = "pin-later";
    const pending = await upload(c);
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).result.status, "UNKNOWN");
    const unknown = await stored(c);
    assert.equal(unknown.attempt.status, "UNKNOWN"); assert.equal(unknown.publication.status, "PINNING"); assert.equal(unknown.publication.ipfsCid, null);
    assert.equal((await upload(c)).status, 409, "an unknown outcome never reopens sending");
    assert.equal((await readback(c)).status, 200);
    assert.equal((await stored(c)).attempt.status, "UNKNOWN", "still unpinned is still unknown");
    for (const [actor, status] of [[null, 401], [operator, 403]]) assert.equal((await readback(c, actor)).status, status);
    kubo.pinned.add(rawCidFromSha256(c.payloadHash));
    assert.equal((await (await readback(c, other)).json()).result.status, "PINNED");
    assert.equal((await stored(c)).publication.ipfsCid, rawCidFromSha256(c.payloadHash));
    kubo.state.mode = "normal";

    // With the offline Kubo fixture, the same route sends to a real node on loopback (no credential).
    if (process.env.PUBLICATION_LOCAL_KUBO === "1") {
      await restart({ key: "fictional-upload-kubo", scope: "isolated-offline-node", apiUrl: "http://127.0.0.1:15001", gatewayUrl: "http://127.0.0.1:18080" });
      const e = await prepared();
      const real = await upload(e);
      assert.equal(real.status, 200);
      const realCid = rawCidFromSha256(e.payloadHash);
      assert.equal((await real.json()).result.status, "PINNED", "the real offline node pinned and served the exact block");
      const pins = await (await fetch(`http://127.0.0.1:15001/api/v0/pin/ls?arg=${realCid}&type=recursive`, { method: "POST" })).json();
      assert.equal(pins.Keys?.[realCid]?.Type, "recursive");
      // The offline node is test-owned; leave it as the other upload scenarios do.
      assert.equal((await fetch(`http://127.0.0.1:15001/api/v0/pin/rm?arg=${realCid}`, { method: "POST" })).status, 200);
    }

    // Without the credential a remote target is not sendable.
    await restart({ key: "fictional-upload", scope: "fictional-remote", apiUrl: "https://rpc.example.invalid", gatewayUrl: "https://gateway.example.invalid" });
    const d = await prepared().catch(error => error);
    assert.ok(d instanceof assert.AssertionError && /enables upload/.test(d.message), "a remote target without a credential leaves upload disabled");
    process.stdout.write("Upload action passed: designated publisher only, exact acknowledgement/target, exact bytes with RPC-only credential, single send, lost acknowledgement and late pin resolved by readback, credential required for a remote target.\n");
  } finally {
    await kubo.close();
  }
}
