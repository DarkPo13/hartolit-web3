import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createJiti } from "jiti";
import { assertOfflineKubo } from "./local-kubo-tunnel.mjs";
import { smokeMintPreparation } from "./smoke-publication-mint-preparation.mjs";
import { smokeMintDispatch } from "./smoke-publication-mint-dispatch.mjs";
import { localMintChain } from "./local-mint-chain.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { createLocalKuboProvider } = await jiti.import("../lib/publication/local-kubo.ts");
const { createPublicationTarget } = await jiti.import("../lib/publication/target.ts");
const { preparePinAttempt } = await jiti.import("../lib/publication/pinning.ts");
const { executePinUpload } = await jiti.import("../lib/publication/upload.ts");
const { reconcilePinAttempt } = await jiti.import("../lib/publication/reconciliation.ts");
const { rawCidFromSha256 } = await jiti.import("../lib/publication/raw-cid.ts");
const rejects = (promise, status = 409) => assert.rejects(promise, (error) => error.status === status);

/** Called only by the local-database-guarded publication smoke. Never loaded by the app. */
export async function smokePinUploads({ api, db, fixture, confirm, ownerId, publisherId, publisher, signingAccount }) {
  const realLocalNode = process.env.PUBLICATION_LOCAL_KUBO === "1";
  if (realLocalNode) assertOfflineKubo();
  const ownedCids = [];
  const candidates = [];
  let chain;
  try {
    if (process.env.PUBLICATION_LOCAL_CHAIN === "1") chain = await localMintChain(signingAccount);
    for (const scenario of ["success", "lost-ack", "before-write-failure"]) {
      const blocks = new Map();
      let writes = 0;
      const transport = realLocalNode ? fetch : async (address, options) => {
        const url = new URL(address);
        if (url.pathname.endsWith("block/put")) {
          const bytes = new Uint8Array(await options.body.get("file").arrayBuffer());
          const cid = rawCidFromSha256(createHash("sha256").update(bytes).digest("hex"));
          blocks.set(cid, bytes);
          return Response.json({ Key: cid, Size: bytes.length });
        }
        const cid = url.searchParams.get("arg") ?? url.pathname.split("/").pop();
        if (url.pathname.endsWith("pin/ls")) return Response.json({ Keys: blocks.has(cid) ? { [cid]: { Type: "recursive" } } : {} });
        return new Response(blocks.get(cid), { status: blocks.has(cid) ? 200 : 404, headers: { "content-type": "application/vnd.ipld.raw" } });
      };
      const provider = await createLocalKuboProvider({ key: `fictional-${scenario}`, apiUrl: "http://127.0.0.1:15001", gatewayUrl: "http://127.0.0.1:18080" }, transport);
      const row = await fixture(ownerId, publisherId), passportId = row.passport.id;
      const confirmation = await confirm(publisher, row);
      const route = `/api/admin/passports/${passportId}/publication`;
      const reserved = await api(route, { user: publisher, method: "POST", body: {
        confirmationId: confirmation.id, passportVersion: 4, expectedSha256: confirmation.preview.sha256, walletAddress: signingAccount.address.toLowerCase(),
      } });
      assert.equal(reserved.status, 201);
      const publicationId = (await reserved.json()).reservation.id;
      const challenge = (await (await api(`${route}/wallet-challenge`, { user: publisher, method: "POST", body: { publicationId } })).json()).challenge;
      assert.equal((await api(`${route}/wallet-proof`, { user: publisher, method: "POST", body: {
        publicationId, challengeId: challenge.id, signature: await signingAccount.signMessage({ message: challenge.message }),
      } })).status, 200);
      const data = { publicationId, requestId: randomUUID(), confirmationId: confirmation.id, passportVersion: 4,
        expectedSha256: confirmation.preview.sha256, expectedTargetSha256: provider.target.configurationSha256, acknowledgement: "PUBLISH_CONFIRMED_SNAPSHOT" };
      await rejects(preparePinAttempt(publisherId, passportId, { ...data, acknowledgement: undefined }, provider.target), 422);
      const { attempt } = await preparePinAttempt(publisherId, passportId, data, provider.target);
      const changed = await createPublicationTarget({ key: provider.target.key, kind: provider.target.kind,
        apiUrl: provider.target.apiUrl, gatewayUrl: provider.target.gatewayUrl, storageProfile: provider.target.storageProfile,
        accountScope: "changed-account" });
      const execute = (selected = provider) => executePinUpload(publisherId, passportId, publicationId, attempt.id, selected);
      await rejects(preparePinAttempt(publisherId, passportId, data, changed));
      await rejects(execute({ ...provider, target: changed }));
      if (scenario === "success") {
        // Historical attempts remain readable history but cannot be silently bound.
        await db.publicationPinAttempt.update({ where: { id: attempt.id }, data: {
          providerKey: null, providerConfigHash: null, storageProfile: null,
        } });
        await rejects(execute());
        await db.publicationPinAttempt.update({ where: { id: attempt.id }, data: {
          providerKey: provider.target.key, providerConfigHash: provider.target.configurationSha256, storageProfile: provider.target.storageProfile,
        } });
      }
      const wrapped = { ...provider, upload: async (command) => {
        writes++;
        if (scenario === "before-write-failure") throw new Error("Fictional connection failure");
        await provider.upload(command);
        if (scenario === "lost-ack") throw new Error("Fictional lost acknowledgement after storage");
      } };
      const cid = rawCidFromSha256(confirmation.preview.sha256); ownedCids.push(cid);
      if (scenario === "success") {
        const results = await Promise.allSettled([execute(wrapped), execute(wrapped), execute(wrapped)]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.status === 409));
        assert.equal(results.find((r) => r.status === "fulfilled").value.status, "PINNED");
      } else if (scenario === "lost-ack") assert.equal((await execute(wrapped)).status, "PINNED", "readback recovers a lost upload acknowledgement");
      else if (realLocalNode) await rejects(execute(wrapped), 503);
      else assert.equal((await execute(wrapped)).status, "UNKNOWN");
      assert.equal(writes, 1);
      await rejects(execute(wrapped)); assert.equal(writes, 1, "a repeat cannot resend even after a failed/unknown upload");
      let wrongTargetReads = 0;
      await rejects(reconcilePinAttempt(passportId, publicationId, attempt.id, changed, async () => {
        wrongTargetReads++; throw new Error("Wrong target must not be queried");
      }));
      assert.equal(wrongTargetReads, 0);
      const stored = await db.publication.findUniqueOrThrow({ where: { id: publicationId } });
      const savedAttempt = await db.publicationPinAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      assert.equal(savedAttempt.providerKey, provider.target.key); assert.equal(savedAttempt.providerConfigHash, provider.target.configurationSha256);
      assert.equal(savedAttempt.storageProfile, provider.target.storageProfile);
      assert.equal(stored.status, scenario === "before-write-failure" ? "PINNING" : "PINNED");
      assert.equal(stored.ipfsCid, scenario === "before-write-failure" ? null : cid);
      assert.equal(stored.canonicalJson, confirmation.preview.canonicalJson); assert.equal(stored.tokenId, null); assert.equal(stored.transactionHash, null);
      assert.equal((await db.passport.findUniqueOrThrow({ where: { id: passportId } })).version, 4);
      const candidate = await smokeMintPreparation({ db, publisherId, passportId, publication: stored, pin: savedAttempt, chainTarget: chain?.target });
      if (candidate) candidates.push(candidate);
    }
    await smokeMintDispatch({ db, publisherId, candidates, chain });
    process.stdout.write(`Upload driver passed: target binding, explicit intent, single send, lost acknowledgement, failed-before-write and no resend (${realLocalNode ? "isolated offline Kubo" : "injected transport"}).\n`);
  } finally {
    await chain?.stop();
    if (realLocalNode) for (const cid of ownedCids) {
      await fetch(`http://127.0.0.1:15001/api/v0/pin/rm?arg=${cid}`, { method: "POST" }).then((response) => response.body?.cancel());
      const deleted = await fetch(`http://127.0.0.1:15001/api/v0/block/rm?arg=${cid}&force=true`, { method: "POST" });
      assert.equal(deleted.status, 200); await deleted.body?.cancel();
    }
  }
}
