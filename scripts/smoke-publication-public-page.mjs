import assert from "node:assert/strict";
import path from "node:path";
import { createJiti } from "jiti";
import { startRawGateway, startVerifierServer } from "./public-verifier-server.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { uk } = await jiti.import("../lib/i18n/translations/uk.ts");

/** End-to-end issue-to-verify: the record just finalized through the internal
 * services is VALID on the anonymous public page, from the bytes the uploader
 * actually sent and the actual chain, with no database access by the page.
 */
export async function smokeIssuedPublicPage({ publication, passportId, chain, uploaded }) {
  const sent = uploaded.get(publication.ipfsCid);
  assert.ok(sent, "the uploader sent the published block");
  assert.equal(Buffer.from(sent).toString("utf8"), publication.canonicalJson, "uploaded bytes are exactly the confirmed public JSON");
  const snapshot = JSON.parse(publication.canonicalJson);
  const gateway = await startRawGateway(uploaded);
  let server;
  try {
    server = await startVerifierServer({ rpcUrl: chain.url, gatewayUrl: gateway.url, target: chain.target });
    const response = await fetch(`${server.base}/passports/${publication.tokenId}`, { redirect: "manual" });
    const html = await response.text();
    assert.equal(response.status, 200);
    for (const text of [uk.publicVerifier.validBadge, snapshot.certificateId, snapshot.farm.label, snapshot.chemical.product, publication.payloadHash,
      publication.ipfsCid, publication.contractAddress, `${server.base}/passports/${publication.tokenId}`]) {
      assert.ok(html.includes(text), `issued public page missing ${text}`);
    }
    // Private identifiers of the issuing workflow never reach the public page.
    for (const value of [publication.id, passportId, publication.confirmationId, "objectKey", "@example.invalid"]) {
      assert.ok(!html.includes(value), `issued public page leaks ${value}`);
    }
  } finally {
    await server?.stop();
    await gateway.close();
  }
  process.stdout.write("Issue-to-verify passed: finalized internal publication is VALID on the anonymous production page from the uploaded bytes and actual chain.\n");
}
