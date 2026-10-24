// Local only: export the self-signed certificate of the `mail-tls` Mailpit profile
// (STARTTLS on 127.0.0.1:1026) so a production build can trust it, as CI does.
// Writes the gitignored .mailpit-tls-ca.pem. Needs openssl on PATH.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const port = process.env.MAILPIT_TLS_SMTP_PORT ?? "1026";
let pem = "";
for (let attempt = 0; attempt < 30 && !pem; attempt++) {
  const handshake = spawnSync("openssl", ["s_client", "-starttls", "smtp", "-connect", `localhost:${port}`, "-showcerts"], { input: "", encoding: "utf8", windowsHide: true });
  pem = handshake.stdout?.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0] ?? "";
  if (!pem) await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!pem) { process.stderr.write(`No STARTTLS certificate on localhost:${port}. Start it with: docker compose --env-file .env.db.local --profile mail-tls up -d mailpit-tls\n`); process.exit(1); }
writeFileSync(".mailpit-tls-ca.pem", `${pem}\n`);
process.stdout.write(`Wrote .mailpit-tls-ca.pem. Run the production app with SMTP_HOST=localhost SMTP_PORT=${port} NODE_EXTRA_CA_CERTS=.mailpit-tls-ca.pem and smokes with MAILPIT_API_URL=http://127.0.0.1:8026.\n`);
