import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";

const storagePath = ".env.storage.local";
const appPath = ".env.local";
if (!existsSync(storagePath)) {
  writeFileSync(storagePath, `EVIDENCE_S3_ACCESS_KEY=${randomBytes(24).toString("hex")}\nEVIDENCE_S3_SECRET_KEY=${randomBytes(36).toString("hex")}\n`, { flag: "wx" });
}
const storage = readFileSync(storagePath, "utf8");
const access = storage.match(/^EVIDENCE_S3_ACCESS_KEY=(.+)$/m)?.[1]?.trim();
const secret = storage.match(/^EVIDENCE_S3_SECRET_KEY=(.+)$/m)?.[1]?.trim();
if (!access || !secret) throw new Error("Local storage credentials are incomplete");
const current = existsSync(appPath) ? readFileSync(appPath, "utf8") : "";
const wanted = {
  EVIDENCE_S3_BUCKET: "hartolit-evidence",
  EVIDENCE_S3_REGION: "us-east-1",
  EVIDENCE_S3_ENDPOINT: "http://127.0.0.1:8333",
  EVIDENCE_S3_ACCESS_KEY: access,
  EVIDENCE_S3_SECRET_KEY: secret,
  EVIDENCE_CLAMD_HOST: "127.0.0.1",
  EVIDENCE_CLAMD_PORT: "3310",
};
const additions = Object.entries(wanted).filter(([key]) => !new RegExp(`^${key}=`, "m").test(current)).map(([key, value]) => `${key}=${value}`);
if (additions.length) appendFileSync(appPath, `${current.endsWith("\n") || !current ? "" : "\n"}${additions.join("\n")}\n`);
process.stdout.write("Local evidence configuration is ready in ignored environment files.\n");
