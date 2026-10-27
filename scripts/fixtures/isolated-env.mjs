import { readFileSync } from "node:fs";
import path from "node:path";

// Fixtures that start their own app must not inherit this machine's real publisher,
// IPFS, mint or verifier settings: a developer's .env.local may point at BSC Testnet
// and a public IPFS node. Call before nextEnv.loadEnvConfig. @next/env keeps values
// that are already set, even empty ones, so every HARTOLIT_* name from the example
// reads as unconfigured unless the shell or the fixture itself sets it.
export function isolatePublicationEnv() {
  const example = readFileSync(path.resolve(".env.local.example"), "utf8");
  for (const name of example.match(/^HARTOLIT_[A-Z0-9_]+(?==)/gm) ?? []) process.env[name] ??= "";
}
