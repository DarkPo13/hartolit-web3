import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { configuredMintReader, configuredMintTarget, mintConfigured } = await jiti.import("../lib/publication/mint-config.ts");

const complete = {
  HARTOLIT_MINT_RPC_URL: "https://rpc.example.invalid/", HARTOLIT_MINT_CONTRACT_ADDRESS: `0x${"A".repeat(40)}`,
  HARTOLIT_MINT_CONTRACT_CODE_HASH: `0x${"b".repeat(64)}`, HARTOLIT_MINT_RECIPIENT_WALLET: `0x${"c".repeat(40)}`,
  HARTOLIT_MINT_CONFIRMATIONS: "3", HARTOLIT_PUBLISHER_WALLET: `0x${"d".repeat(40)}`,
};
function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(complete).map(key => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } return run(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("mint configuration is server-only, Testnet-only and complete before anything is offered", () => {
  withEnv(complete, () => {
    assert.equal(mintConfigured(), true);
    assert.deepEqual(configuredMintTarget(), { chainId: 97, contractAddress: `0x${"a".repeat(40)}`, contractCodeHash: `0x${"b".repeat(64)}`,
      publisherWallet: `0x${"d".repeat(40)}`, recipientWallet: `0x${"c".repeat(40)}`, requiredConfirmations: 3 });
    assert.equal(configuredMintReader().chain.id, 97);
  });
  for (const rpc of ["http://127.0.0.1:8545", "http://localhost:8545/", "http://[::1]:8545"]) {
    withEnv({ ...complete, HARTOLIT_MINT_RPC_URL: rpc }, () => assert.equal(mintConfigured(), true, `${rpc} is a node on this machine`));
  }
  for (const rpc of ["http://rpc.example.invalid/", "https://user:secret@rpc.example.invalid/", "ftp://rpc.example.invalid/", "not a url", "", undefined]) {
    withEnv({ ...complete, HARTOLIT_MINT_RPC_URL: rpc }, () => {
      assert.equal(mintConfigured(), false, `${rpc} is refused`);
      assert.throws(() => configuredMintReader(), error => error.status === 503);
    });
  }
  for (const [key, value] of [["HARTOLIT_MINT_CONTRACT_ADDRESS", "0x1234"], ["HARTOLIT_MINT_CONTRACT_CODE_HASH", undefined],
    ["HARTOLIT_MINT_RECIPIENT_WALLET", undefined], ["HARTOLIT_MINT_CONFIRMATIONS", "1"], ["HARTOLIT_MINT_CONFIRMATIONS", "257"], ["HARTOLIT_MINT_CONFIRMATIONS", "2.5"]]) {
    withEnv({ ...complete, [key]: value }, () => assert.equal(mintConfigured(), false, `${key}=${value} is incomplete`));
  }
});
