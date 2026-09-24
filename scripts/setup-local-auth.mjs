import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";

const dbEnvPath = ".env.db.local";
const appEnvPath = ".env.local";

if (!existsSync(dbEnvPath)) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(dbEnvPath, `POSTGRES_USER=hartolit\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=hartolit\n`, { flag: "wx" });
}

const dbEnv = readFileSync(dbEnvPath, "utf8");
const dbPassword = dbEnv.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!dbPassword) throw new Error(".env.db.local is missing POSTGRES_PASSWORD");

const existing = existsSync(appEnvPath) ? readFileSync(appEnvPath, "utf8") : "";
const additions = [];
if (!/^DATABASE_URL=/m.test(existing)) {
  additions.push(`DATABASE_URL=postgresql://hartolit:${encodeURIComponent(dbPassword)}@127.0.0.1:55432/hartolit?schema=public`);
}
if (!/^BETTER_AUTH_SECRET=/m.test(existing)) {
  additions.push(`BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`);
}
if (!/^BETTER_AUTH_URL=/m.test(existing)) {
  additions.push("BETTER_AUTH_URL=http://localhost:3000");
}
if (!/^SMTP_HOST=/m.test(existing)) additions.push("SMTP_HOST=127.0.0.1");
if (!/^SMTP_PORT=/m.test(existing)) additions.push("SMTP_PORT=1025");
if (!/^SMTP_FROM=/m.test(existing)) additions.push("SMTP_FROM=Hartolit Local <no-reply@hartolit.local>");
if (additions.length) {
  appendFileSync(appEnvPath, `${existing.endsWith("\n") || !existing ? "" : "\n"}${additions.join("\n")}\n`);
}

process.stdout.write("Local auth configuration is ready in ignored environment files.\n");
