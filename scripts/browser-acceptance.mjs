// Full fictional workflow in a real browser (guide local checklist 5; D65):
// MFA enrolment, emailed invitation, draft with offline save, uploads through
// ClamAV, submission, keyboard review and snapshot confirmation, UK/EN, 390px.
// Local only. Needs: migrated local PostgreSQL, SeaweedFS and ClamAV, the
// `mail-tls` Mailpit profile with `npm run mail:tls-ca`, a production build,
// free port 3000 (evidence CORS), and Chrome (or BROWSER_EXECUTABLE).
// Fictional @example.invalid users only; everything it creates is deleted.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import * as playwright from "playwright-core";
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { isolatePublicationEnv } from "./fixtures/isolated-env.mjs";

isolatePublicationEnv();
nextEnv.loadEnvConfig(process.cwd());
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Browser acceptance requires a local database");
const ca = path.resolve(".mailpit-tls-ca.pem");
if (!existsSync(ca)) throw new Error("Run `npm run mail:tls-ca` with the mail-tls Mailpit profile first (README, Production mail locally)");
const port = 3000, base = `http://127.0.0.1:${port}`;
const mailpit = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8026", smtpPort = process.env.MAILPIT_TLS_SMTP_PORT ?? "1026";
const suffix = randomBytes(6).toString("hex");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error("BROWSER_ENGINE must be chromium, firefox or webkit");
const out = process.env.BROWSER_ACCEPTANCE_OUT ?? path.join(os.tmpdir(), `hartolit-browser-acceptance-${suffix}`);
await mkdir(out, { recursive: true });
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ auth }, { getDb }, { uk }, { en }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts"),
  jiti.import("../lib/i18n/translations/uk.ts"), jiti.import("../lib/i18n/translations/en.ts")]);
const db = getDb();
const adminPassword = `${randomBytes(18).toString("base64url")}aA1!`, operatorPassword = `${randomBytes(18).toString("base64url")}bB2!`;
const adminEmail = `browser-admin-${suffix}@example.invalid`, operatorEmail = `browser-operator-${suffix}@example.invalid`;
const findings = [], note = (ok, text) => { findings.push(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) process.exitCode = 1; };
const errors = [], failures = [];
const watch = (page, label) => {
  page.on("response", r => { if (r.status() >= 400) failures.push(`${label} ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
};
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } });
const bucketKeys = async () => ((await s3.send(new ListObjectsV2Command({ Bucket: process.env.EVIDENCE_S3_BUCKET }))).Contents ?? []).map(o => o.Key);
const keysBefore = new Set(await bucketKeys());
const rateKeysBefore = new Set((await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key));

function totp(uri, offset = 0) {
  const secret = new URL(uri).searchParams.get("secret"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(letter => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
// A TOTP code is accepted once; wait for the next window before signing in again.
const nextWindow = page => page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
async function mailLink(email) {
  for (let i = 0; i < 40; i++) {
    const inbox = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    if (inbox.messages?.length) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${inbox.messages[0].ID}`)).json();
      return message.Text?.match(/https?:\/\/[^\s]+/)?.[0];
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

let server, browser;
try {
  await auth.api.createUser({ body: { name: "Fictional Browser Admin", email: adminEmail, password: adminPassword, role: "admin" } });
  const adminId = (await db.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
  const probe = net.createServer(); await new Promise((r, j) => { probe.once("error", j); probe.listen(port, "127.0.0.1", r); }); await new Promise(r => probe.close(r));
  server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base, HARTOLIT_PUBLISHER_USER_ID: adminId, HARTOLIT_PUBLISHER_WALLET: `0x${"1".repeat(40)}`,
      SMTP_HOST: "localhost", SMTP_PORT: smtpPort, NODE_EXTRA_CA_CERTS: ca },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const serverLog = [];
  let ready = false;
  server.stdout.on("data", c => { serverLog.push(c.toString()); if (c.toString().includes("Ready in")) ready = true; });
  server.stderr.on("data", c => serverLog.push(c.toString()));
  for (let i = 0; i < 120 && !ready; i++) await new Promise(r => setTimeout(r, 250));
  assert.ok(ready, "server not ready");
  // Chromium uses an installed Chrome/Edge; firefox and webkit need `npx playwright-core install <engine>`.
  browser = engine === "chromium"
    ? await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }) })
    : await playwright[engine].launch({ headless: true });

  // 1. Admin: first sign-in must enrol MFA through the UI.
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage(); watch(admin, "admin");
  await admin.goto(`${base}/admin`);
  note(new URL(admin.url()).pathname === "/login", "anonymous /admin redirects to login");
  await admin.getByLabel(uk.account.email).fill(adminEmail);
  await admin.getByLabel(uk.account.password).fill(adminPassword);
  await admin.getByRole("button", { name: uk.account.signIn }).click();
  await admin.waitForURL(url => url.pathname === "/settings/security", { timeout: 15_000 });
  note(true, "admin without MFA is sent to account security");
  await admin.getByLabel(uk.account.setupPassword).fill(adminPassword);
  const enabled = admin.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/two-factor/enable");
  await admin.getByRole("button", { name: uk.account.setupStart }).click();
  const { totpURI: totpUri, backupCodes } = await (await enabled).json();
  await admin.getByRole("img", { name: uk.account.authenticatorQrAlt }).waitFor();
  note(true, "setup shows the authenticator QR code");
  await admin.getByLabel(uk.account.code).fill(totp(totpUri));
  await admin.getByRole("button", { name: uk.account.verify }).click();
  await admin.getByText(uk.account.backupCodes).first().waitFor({ timeout: 15_000 });
  note(await admin.getByText(uk.account.backupWarning).isVisible(), "recovery codes shown once with the warning");
  await admin.screenshot({ path: path.join(out, "mfa-complete.png"), fullPage: true });
  await admin.goto(`${base}/admin`);
  if (new URL(admin.url()).pathname !== "/login") note(false, `after MFA setup /admin went to ${new URL(admin.url()).pathname}`);
  await admin.getByLabel(uk.account.email).fill(adminEmail);
  await admin.getByLabel(uk.account.password).fill(adminPassword);
  await admin.getByRole("button", { name: uk.account.signIn }).click();
  await admin.waitForURL(url => url.pathname === "/two-factor", { timeout: 15_000 });
  await nextWindow(admin);
  await admin.getByLabel(uk.account.code).fill(totp(totpUri));
  await admin.getByRole("button", { name: uk.account.verify }).click();
  await admin.waitForURL(url => url.pathname !== "/two-factor", { timeout: 15_000 });
  await admin.goto(`${base}/admin`);
  await admin.getByRole("heading", { name: uk.adminShell.items.overview, level: 1 }).waitFor();
  note(true, "admin signs in with password and TOTP through the UI");
  const adminMenu = admin.getByRole("navigation", { name: uk.adminShell.sections });

  // 2. Invite the operator through the admin console.
  await adminMenu.getByRole("link", { name: uk.adminShell.items.users }).click();
  await admin.getByRole("heading", { name: uk.adminShell.items.users, level: 1 }).waitFor();
  note(new URL(admin.url()).pathname === "/admin/users" && await adminMenu.getByRole("link", { name: uk.adminShell.items.users }).getAttribute("aria-current") === "page",
    "the admin menu opens the users page and marks it as current");
  await admin.getByLabel(uk.management.inviteName).fill("Fictional Browser Operator");
  await admin.getByLabel(uk.management.inviteEmail).fill(operatorEmail);
  await admin.getByRole("button", { name: uk.management.invite }).click();
  await admin.getByText(uk.management.invited).waitFor({ timeout: 15_000 });
  note(true, "invitation through the UI requests the password setup email");
  const link = await mailLink(operatorEmail);
  if (!link) await writeFile(path.join(out, "server.log"), serverLog.join(""));
  note(!!link && new URL(link).origin === base, "invitation email arrives with a link to this app");

  // 3. Operator sets a password from the email link and signs in.
  // Firefox has no mobile emulation; it still gets the 390px viewport.
  const opContext = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(engine === "firefox" ? {} : { isMobile: true, hasTouch: true }) });
  const op = await opContext.newPage(); watch(op, "operator");
  await op.goto(link);
  await op.getByLabel(uk.account.newPassword).fill(operatorPassword);
  await op.getByRole("button", { name: uk.account.resetSubmit }).click();
  await op.getByText(uk.account.resetSuccess).waitFor({ timeout: 15_000 });
  note(true, "operator sets a password from the invitation link");
  await op.goto(`${base}/`);
  note(new URL(op.url()).pathname === "/login", "operator home requires sign-in");
  await op.getByLabel(uk.account.email).fill(operatorEmail);
  await op.getByLabel(uk.account.password).fill(operatorPassword);
  await op.getByRole("button", { name: uk.account.signIn }).click();
  await op.waitForURL(url => url.pathname === "/", { timeout: 15_000 });
  await op.getByRole("button", { name: uk.drafts.newDraft }).waitFor();
  note(true, "operator signs in and reaches the draft workspace");
  note(await overflow(op) <= 0, "operator home: no overflow at 390px");
  note(await op.locator('a[href^="/verify"]').count() === 0, "no link to the production-disabled legacy verifier");
  await op.getByRole("button", { name: uk.drafts.newDraft }).click();
  const saved = op.getByRole("status").filter({ hasText: uk.drafts.saved });
  await saved.waitFor({ timeout: 15_000 });
  note(true, "new draft is saved to the account");
  const optionText = await op.getByLabel(uk.drafts.choose).locator("option").first().innerText();
  note(!/\d{1,2}\/\d{1,2}\/\d{4}/.test(optionText), `draft list date uses the Ukrainian format (${optionText})`);

  // 4. Fill every required fact; autosave after each section.
  const marker = `Fictional Browser Farm ${suffix}`;
  const titles = { "01": uk.farmer.blockTitle, "02": uk.treatment.blockTitle, "03": uk.meteo.blockTitle, "04": uk.chemical.blockTitle };
  // Completed sections are renamed to their summary, so match by number or title.
  const section = async key => {
    const button = op.getByRole("button", { name: new RegExp(`^(${key} )?${titles[key]}`) });
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  };
  // Radix select: click (or Enter from the keyboard) on the trigger, then the option.
  const pick = async (label, option, keyboard = false) => {
    const trigger = op.getByLabel(label);
    if (keyboard) { await trigger.focus(); await op.keyboard.press("Enter"); } else await trigger.click();
    await op.getByRole("option", { name: option, exact: true }).click();
  };
  await section("01");
  await op.getByLabel(uk.farmer.nameLabel).fill(marker);
  await op.getByLabel(uk.farmer.publicFarmLabel, { exact: true }).fill("Fictional Public Farm");
  await op.getByLabel(uk.farmer.areaLabel).fill("12.5");
  await pick(uk.farmer.cropLabel, uk.crops.sunflower, true);
  note((await op.getByLabel(uk.farmer.cropLabel).innerText()).includes(uk.crops.sunflower), "crop chosen from the keyboard");
  await saved.waitFor({ timeout: 15_000 });
  // Interrupted save: offline while editing keeps the change in the tab, then retries.
  await section("02");
  await opContext.setOffline(true);
  await pick(uk.treatment.typeLabel, uk.treatmentTypes.herbicide);
  await op.getByLabel(uk.treatment.dateLabel).fill("2026-09-01");
  await op.getByText(uk.drafts.saveError).waitFor({ timeout: 20_000 }).catch(() => {});
  const offlineStatus = await op.getByRole("alert").or(op.getByRole("status")).allInnerTexts();
  note(offlineStatus.some(text => text.includes(uk.drafts.saveError) || text.includes(uk.drafts.unsaved)), "offline edit is reported as not saved");
  await opContext.setOffline(false);
  const retry = op.getByRole("button", { name: uk.drafts.retry });
  if (await retry.count()) await retry.click();
  await saved.waitFor({ timeout: 20_000 });
  note(true, "after reconnecting the change is saved");
  await op.getByLabel(uk.treatment.timeLabel).fill("09:30");
  await op.getByLabel(uk.treatment.timeZoneLabel).fill("Europe/Kyiv");
  await op.getByLabel(uk.treatment.treatedAreaLabel).fill("10.25");
  await op.getByLabel(uk.treatment.modelLabel).fill("Fictional Drone");
  await op.getByLabel(uk.treatment.operatorLabel).fill("Fictional Pilot");
  await section("03");
  await op.getByLabel(uk.meteo.tempLabel).fill("22.5");
  await op.getByLabel(uk.meteo.humidityLabel).fill("60");
  await op.getByLabel(uk.meteo.windLabel).fill("2.5");
  await op.getByLabel(uk.meteo.rainLabel).fill("0");
  await op.getByLabel(uk.meteo.measuredAtLabel).fill("2026-09-01T06:30");
  await section("04");
  await op.getByLabel(uk.chemical.nameLabel).fill("Fictional Product");
  await op.getByLabel(uk.chemical.doseLabel, { exact: true }).fill("1.25");
  await pick(uk.chemical.doseUnitLabel, uk.chemical.doseUnitLitres);
  await op.getByLabel(uk.chemical.volumeLabel).fill("25");
  await saved.waitFor({ timeout: 15_000 });
  await op.waitForTimeout(2500);
  const meteoHeader = await op.getByRole("button", { name: new RegExp(`^${uk.meteo.blockTitle}`) }).innerText();
  note(meteoHeader.includes(uk.meteo.windUnit) && !meteoHeader.includes("m/s"), "collapsed weather summary uses Ukrainian units");
  // Reload: the server copy is what remains.
  await op.reload(); await op.getByRole("button", { name: uk.drafts.newDraft }).waitFor();
  await section("04");
  note(await op.getByLabel(uk.chemical.volumeLabel).inputValue() === "25", "after reload the last field is restored from the server");
  await section("01");
  note(await op.getByLabel(uk.farmer.nameLabel).inputValue() === marker, "after reload the first field is restored");
  // A busy server (503) saves nothing; autosave must wait and retry without a click.
  let busyAnswers = 0;
  await op.route("**/api/drafts/*", route => route.request().method() === "PATCH" && busyAnswers === 0
    ? (busyAnswers++, route.fulfill({ status: 503, headers: { "Retry-After": "1", "Content-Type": "application/json" }, body: "{}" }))
    : route.continue());
  const patch = status => response => response.request().method() === "PATCH" && response.status() === status && /\/api\/drafts\/[^/]+$/.test(new URL(response.url()).pathname);
  const busyAnswer = op.waitForResponse(patch(503), { timeout: 20_000 });
  await op.getByLabel(uk.farmer.areaLabel).fill("12.75");
  await busyAnswer;
  await op.waitForResponse(patch(200), { timeout: 20_000 });
  await saved.waitFor({ timeout: 20_000 });
  await op.unroute("**/api/drafts/*");
  note(busyAnswers === 1 && await op.getByRole("button", { name: uk.drafts.retry }).count() === 0, "a busy-server answer is retried automatically and then saved");
  await op.getByLabel(uk.farmer.areaLabel).fill("12.5");
  await op.waitForResponse(patch(200), { timeout: 20_000 });

  // 5. Evidence through the real storage and ClamAV.
  const evidence = op.getByRole("region", { name: uk.evidence.title });
  const upload = async (kind, name, mimeType, buffer) => {
    await evidence.getByLabel(uk.evidence.kind).selectOption(kind);
    await evidence.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
    await evidence.getByRole("button", { name: uk.evidence.upload }).click();
    const row = evidence.locator("li").filter({ hasText: name });
    await row.getByText(new RegExp(`${uk.evidence.ready}|${uk.evidence.rejected}`)).waitFor({ timeout: 60_000 });
    return row.innerText();
  };
  note((await upload("METEO", `weather-${suffix}.txt`, "text/plain", Buffer.from("Fictional weather station export\n22.5 C, 60 %, 2.5 m/s\n"))).includes(uk.evidence.ready), "weather file uploaded and scanned clean");
  note((await upload("CHEMICAL", `invoice-${suffix}.pdf`, "application/pdf", Buffer.from("%PDF-1.4\n% Fictional invoice\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"))).includes(uk.evidence.ready), "chemical PDF uploaded and scanned clean");
  const eicar = Buffer.from(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""));
  note((await upload("OTHER", `eicar-${suffix}.txt`, "text/plain", eicar)).includes(uk.evidence.rejected), "malware test file is rejected by the scanner");
  note(await overflow(op) <= 0, "draft with evidence: no overflow at 390px");
  await op.screenshot({ path: path.join(out, "operator-evidence.png"), fullPage: true });

  // 6. Submit.
  await op.getByRole("button", { name: uk.review.submit }).click();
  const mine = op.getByRole("region", { name: uk.review.myPassports });
  await mine.getByText(uk.review.submitted).first().waitFor({ timeout: 20_000 });
  note(true, "submitted passport appears as submitted");

  // 7. Admin: claim, approve from the keyboard, confirm the exact public snapshot.
  await adminMenu.getByRole("link", { name: uk.adminShell.items.queue }).click();
  const queued = admin.locator("li").filter({ hasText: marker });
  await queued.waitFor({ timeout: 15_000 });
  note((await queued.innerText()).includes(uk.crops.sunflower), "admin queue shows the localized crop");
  await queued.getByRole("link").first().click();
  await admin.waitForURL(url => /^\/admin\/passports\/[^/]+$/.test(url.pathname), { timeout: 15_000 });
  note(true, "a queued record opens on its own page");
  await admin.getByRole("button", { name: uk.review.claim }).click();
  const approve = admin.getByRole("radio", { name: uk.review.approve });
  await approve.waitFor({ timeout: 15_000 });
  await approve.focus(); await admin.keyboard.press("Space");
  note(await approve.isChecked(), "approve chosen from the keyboard");
  await admin.getByRole("button", { name: uk.review.saveDecision }).focus(); await admin.keyboard.press("Enter");
  await admin.getByText(uk.review.publicPreview.weatherSource).waitFor({ timeout: 15_000 });
  note(true, "approval opens the public snapshot step");
  await admin.getByLabel(uk.review.publicPreview.weatherSource).selectOption({ label: `weather-${suffix}.txt` });
  await admin.getByLabel(uk.review.publicPreview.chemicalSource).selectOption({ label: `invoice-${suffix}.pdf` });
  note(await admin.getByLabel(uk.review.publicPreview.weatherSource).locator("option", { hasText: `eicar-${suffix}` }).count() === 0, "a rejected file cannot be chosen as a source");
  await admin.getByRole("button", { name: uk.review.publicPreview.show }).click();
  const confirmCheck = admin.getByRole("checkbox", { name: uk.review.publicPreview.confirmCheck });
  await confirmCheck.waitFor({ timeout: 15_000 });
  note((await admin.locator("main").innerText()).includes("Fictional Public Farm"), "preview shows the public farm label");
  const confirmButton = admin.getByRole("button", { name: uk.review.publicPreview.confirm });
  note(await confirmButton.isDisabled(), "confirmation requires the explicit check");
  await confirmCheck.check(); await confirmButton.click();
  await admin.getByText(uk.review.publicPreview.confirmedTitle).waitFor({ timeout: 15_000 });
  note(await admin.getByText(uk.publisher.title).count() > 0, "confirmed snapshot leads to the publication step");
  let detailText = "";
  for (const tab of [uk.adminShell.tabs.data, uk.adminShell.tabs.evidence, uk.adminShell.tabs.history]) {
    await admin.getByRole("tab", { name: tab }).click();
    detailText += await admin.locator("main").innerText();
  }
  note(detailText.includes(uk.codes.audit.PASSPORT_SUBMITTED) && detailText.includes(uk.treatmentTypes.herbicide) && !/PASSPORT SUBMITTED|\bherbicide\b|· (READY|METEO)\b/.test(detailText),
    "admin detail shows localized audit actions, treatment type and evidence states");
  note(await overflow(admin) <= 0, "admin detail: no overflow");
  await admin.screenshot({ path: path.join(out, "admin-confirmed.png"), fullPage: true });

  // 8. Operator sees the outcome, in both languages.
  await mine.getByRole("button", { name: uk.review.refresh }).click();
  await mine.getByText(uk.review.approved).first().waitFor({ timeout: 15_000 });
  note(true, "operator sees the passport approved");
  note((await mine.innerText()).includes(uk.crops.sunflower), "operator list shows the localized crop");
  await op.getByRole("button", { name: "EN" }).click();
  await op.getByRole("region", { name: en.review.myPassports }).getByText(en.review.approved).first().waitFor({ timeout: 10_000 });
  note(true, "operator view switches to English");
  note(await op.getByRole("button", { name: "EN" }).getAttribute("aria-pressed") === "true" && await op.getByRole("button", { name: "UK" }).getAttribute("aria-pressed") === "false", "language toggle exposes the active language");
  note(await op.evaluate(() => document.documentElement.lang) === "en", "the page language follows the toggle (screen readers)");
  note((await op.getByRole("region", { name: en.review.myPassports }).innerText()).includes(en.crops.sunflower), "operator list shows the English crop");
  note(await overflow(op) <= 0, "operator EN: no overflow at 390px");
  await op.screenshot({ path: path.join(out, "operator-approved-en.png"), fullPage: true });
  // 9. Lost authenticator: a saved recovery code signs the admin in through the UI.
  const recoveryContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const recovery = await recoveryContext.newPage(); watch(recovery, "recovery");
  await recovery.goto(`${base}/login`);
  await recovery.getByLabel(uk.account.email).fill(adminEmail);
  await recovery.getByLabel(uk.account.password).fill(adminPassword);
  await recovery.getByRole("button", { name: uk.account.signIn }).click();
  await recovery.waitForURL(url => url.pathname === "/two-factor", { timeout: 15_000 });
  await recovery.getByRole("button", { name: uk.account.useRecoveryCode }).click();
  await recovery.getByLabel(uk.account.recoveryCode).fill(backupCodes[0]);
  await recovery.getByRole("button", { name: uk.account.verify }).click();
  await recovery.waitForURL(url => url.pathname === "/settings/security", { timeout: 15_000 });
  note(await recovery.getByRole("form", { name: uk.account.replaceTitle }).isVisible(), "a recovery code signs the admin in and offers to replace the authenticator");
  await recoveryContext.close();
  const audit = await db.auditLog.findMany({ where: { passport: { farmer: { legalName: marker } } }, select: { action: true } });
  note(["PASSPORT_SUBMITTED", "REVIEW_ASSIGNED", "REVIEW_APPROVED"].every(action => audit.some(row => row.action === action)), "audit trail recorded");
  // The rejected malware upload is the only expected HTTP failure; going offline is the only expected console noise.
  const expected = failures.filter(line => !/^operator 409 POST \/api\/drafts\/[^/]+\/evidence\/[^/]+\/complete$|^operator 503 PATCH \/api\/drafts\/[^/]+$/.test(line));
  note(expected.length === 0 && failures.length === 2, `only the rejected malware upload and the simulated busy answer failed over HTTP (${failures.length})`);
  const unexpected = errors.filter(line => !/ERR_INTERNET_DISCONNECTED|status of 409|status of 503/.test(line));
  note(unexpected.length === 0, `no unexpected console/page errors (${unexpected.join(" | ").slice(0, 300)})`);
} catch (error) {
  note(false, `aborted: ${error.message.split("\n")[0]}`);
  for (const [i, page] of (browser?.contexts() ?? []).flatMap(context => context.pages()).entries()) {
    await writeFile(path.join(out, `failure-${i}.yml`), await page.locator("body").ariaSnapshot().catch(() => "")).catch(() => {});
  }
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  for (const email of [adminEmail, operatorEmail]) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    for (const passport of await db.passport.findMany({ where: { ownerId: user.id }, select: { id: true, farmerId: true, fieldId: true } })) {
      await db.publicationPinAttempt.deleteMany({ where: { publication: { passportId: passport.id } } });
      await db.publication.deleteMany({ where: { passportId: passport.id } });
      await db.publicSnapshotConfirmation.deleteMany({ where: { passportId: passport.id } });
      for (const model of ["auditLog", "evidenceFile", "chemicalApplication", "meteoMeasurement", "treatment", "draftRetentionNotice"]) await db[model].deleteMany({ where: { passportId: passport.id } });
      await db.passport.delete({ where: { id: passport.id } });
      await db.field.deleteMany({ where: { id: passport.fieldId } }); await db.farmer.deleteMany({ where: { id: passport.farmerId } });
    }
    await db.field.deleteMany({ where: { ownerId: user.id } }); await db.farmer.deleteMany({ where: { ownerId: user.id } });
    await db.adminAction.deleteMany({ where: { actorId: user.id } }).catch(() => {});
  }
  await db.user.deleteMany({ where: { email: { in: [adminEmail, operatorEmail] } } });
  // Objects this run uploaded (local fixture bucket; nothing else writes during the pass).
  for (const key of (await bucketKeys()).filter(key => !keysBefore.has(key))) await s3.send(new DeleteObjectCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET, Key: key }));
  const newKeys = (await db.rateLimit.findMany({ select: { key: true } })).map(r => r.key).filter(k => !rateKeysBefore.has(k));
  await db.rateLimit.deleteMany({ where: { key: { in: newKeys } } });
  await db.$disconnect();
  process.stdout.write(`${findings.join("\n")}\n${failures.length ? `http failures: ${failures.join(" | ")}\n` : ""}` +
    `${errors.length ? `console/page errors: ${errors.join(" | ").slice(0, 800)}\n` : ""}Screenshots: ${out}\n`);
}
