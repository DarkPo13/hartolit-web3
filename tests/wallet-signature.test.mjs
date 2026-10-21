import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createJiti } from "jiti";

const { verifyPublisherSignature } = await createJiti(import.meta.url).import("../lib/publication/wallet-signature.ts");

test("only the intended wallet's exact EIP-191 message is accepted", async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const message = "Fictional Hartolit wallet ownership\nNonce: test-only";
  const signature = await wallet.signMessage({ message });
  assert.equal(await verifyPublisherSignature(wallet.address.toLowerCase(), message, signature), true);
  assert.equal(await verifyPublisherSignature(other.address, message, signature), false, "another wallet cannot use the signature");
  assert.equal(await verifyPublisherSignature(wallet.address, `${message}\nChanged`, signature), false, "message bytes cannot change");
  assert.equal(await verifyPublisherSignature(wallet.address, message, `0x${"00".repeat(65)}`), false, "invalid recovery fails closed");
  assert.equal(await verifyPublisherSignature(wallet.address, message, "0x12"), false);
});
