// Accessibility audit of every page kind (WCAG 2.2 AA with axe-core, keyboard focus,
// page language, overflow, 200% text) for anonymous, operator and admin users in UK/EN at
// 1280 and 390 px. Local only: migrated PostgreSQL, SeaweedFS and ClamAV, a production
// build and Chrome (or BROWSER_ENGINE=firefox). WebKit needs HTTPS for the production
// session cookie: set A11Y_TLS_DIR to a folder with key.pem/cert.pem for localhost.
// Fictional @example.invalid users only; everything it creates is deleted.
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { createJiti } from "jiti";
import * as playwright from "playwright-core";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isolatePublicationEnv } from "./fixtures/isolated-env.mjs";

isolatePublicationEnv();
nextEnv.loadEnvConfig(process.cwd());
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("The accessibility audit requires a local database");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error("BROWSER_ENGINE must be chromium, firefox or webkit");
const tlsDir = process.env.A11Y_TLS_DIR;
if (engine === "webkit" && !tlsDir) throw new Error("WebKit drops the production Secure cookie over plain HTTP: set A11Y_TLS_DIR");
const port = 3210, tlsPort = 3443, base = tlsDir ? `https://localhost:${tlsPort}` : `http://127.0.0.1:${port}`;
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const suffix = randomBytes(6).toString("hex");
const out = process.env.A11Y_AUDIT_OUT ?? path.join(os.tmpdir(), `hartolit-a11y-audit-${suffix}`);
await mkdir(out, { recursive: true });
process.env.BETTER_AUTH_URL = base;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const [{ auth }, { getDb }, { uk }, { en }] = await Promise.all([jiti.import("../auth.cli.ts"), jiti.import("../lib/db-core.ts"),
  jiti.import("../lib/i18n/translations/uk.ts"), jiti.import("../lib/i18n/translations/en.ts")]);
const db = getDb();
const password = `${randomBytes(18).toString("base64url")}aA1!`;
const emails = { op: `a11y-op-${suffix}@example.invalid`, admin: `a11y-admin-${suffix}@example.invalid` };
const findings = [], note = (ok, text) => { findings.push(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) process.exitCode = 1; };
const rateKeysBefore = new Set((await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key));
const s3 = new S3Client({ region: process.env.EVIDENCE_S3_REGION, endpoint: process.env.EVIDENCE_S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } });

function jar() {
  const cookies = new Map();
  return { cookies, header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), add(response) {
    for (const header of response.headers.getSetCookie()) { const [pair] = header.split(";"); const i = pair.indexOf("="); if (i >= 0) cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
  } };
}
// Distinct fictional client addresses keep repeated local runs under the sign-in rate limit.
const clientIp = `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
async function api(route, { user, method = "GET", body } = {}) {
  const response = await fetch(new URL(route, base), { method, redirect: "manual", headers: { origin: base, "x-forwarded-for": clientIp,
    ...(body ? { "content-type": "application/json" } : {}), ...(user ? { cookie: user.header() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  user?.add(response); return response;
}
function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(letter => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
const data = {
  farmer: { farmerName: "Fictional A11y Farm", publicFarmLabel: "Fictional Public Farm", farmerId: "X", fieldArea: 12.5, gpsCoords: "", cadastralNumber: "", crop: "sunflower" },
  treatment: { treatmentType: "herbicide", treatmentDate: "2026-09-01", treatmentTime: "09:30", timeZone: "Europe/Kyiv", treatedAreaHectares: 10.25, droneModel: "Fictional Drone", droneSerial: "", operator: "Fictional Pilot", pilotCert: "", notes: "" },
  meteo: { temperatureCelsius: 22.5, humidityPercent: 60, windSpeedMps: 2.5, rainfallMm: 0, measuredAt: "2026-09-01T06:30:00.000Z" },
  chemical: { chemical: "Fictional Product", chemicalActive: "", dose: 1.25, doseUnit: "L_PER_HA", workingVolume: 25, manufacturer: "", regNumber: "", supplierName: "", supplierEdrpou: "" },
};

const summary = new Map();
async function audit(page, label) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
  for (const violation of result.violations) {
    const key = `${violation.impact} ${violation.id}`, entry = summary.get(key) ?? { help: violation.help, pages: new Set(), targets: new Set() };
    entry.pages.add(label);
    for (const node of violation.nodes.slice(0, 4)) entry.targets.add(`${node.target.join(" ")} — ${(node.failureSummary ?? "").split("\n")[1]?.trim().slice(0, 140) ?? ""}`);
    summary.set(key, entry);
  }
  note(result.violations.length === 0, `axe ${label}: ${result.violations.map(v => `${v.impact}:${v.id}×${v.nodes.length}`).join(", ") || "no violations"}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  note(overflow <= 0, `${label}: no horizontal overflow (${overflow}px)`);
}
// Tab through the page: every focused element must show a focus indicator.
async function keyboard(page, label, steps) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const missing = [], seen = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const element = document.activeElement; if (!element || element === document.body) return null;
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      const visible = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || (style.boxShadow && style.boxShadow !== "none");
      return { name: `${element.tagName.toLowerCase()}:${(element.innerText || element.value || element.getAttribute("aria-label") || "").trim().slice(0, 30)}`, visible, area: box.width * box.height };
    });
    if (!info) break;
    seen.push(info.name); if (!info.visible || info.area === 0) missing.push(info.name);
  }
  note(seen.length > 0 && missing.length === 0, `keyboard ${label}: ${seen.length} stops with visible focus (${missing.slice(0, 6).join(" | ") || "ok"})`);
}

let server, browser, proxy;
const uploaded = [];
try {
  for (const [kind, email] of Object.entries(emails)) await auth.api.createUser({ body: { name: `Fictional A11y ${kind}`, email, password, role: kind === "admin" ? "admin" : "user" } });
  const adminId = (await db.user.findUniqueOrThrow({ where: { email: emails.admin } })).id;
  const probe = net.createServer(); await new Promise((r, j) => { probe.once("error", j); probe.listen(port, "127.0.0.1", r); }); await new Promise(r => probe.close(r));
  server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: base, HARTOLIT_PUBLISHER_USER_ID: adminId, HARTOLIT_PUBLISHER_WALLET: `0x${"1".repeat(40)}` },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let ready = false; server.stdout.on("data", chunk => { if (chunk.toString().includes("Ready in")) ready = true; });
  for (let i = 0; i < 120 && !ready; i++) await new Promise(r => setTimeout(r, 250));
  if (!ready) throw new Error("server not ready");
  if (tlsDir) {
    // Test-only TLS terminator for WebKit; trust comes from NODE_EXTRA_CA_CERTS for this process.
    const [key, cert] = await Promise.all([readFile(path.join(tlsDir, "key.pem")), readFile(path.join(tlsDir, "cert.pem"))]);
    proxy = createHttpsServer({ key, cert }, (incoming, outgoing) => {
      const upstream = httpRequest({ host: "127.0.0.1", port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, "x-forwarded-proto": "https" } },
        response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
      upstream.on("error", () => { outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(upstream);
    });
    await new Promise(r => proxy.listen(tlsPort, "127.0.0.1", r));
  }

  // Fixtures through the API: an operator with a submitted record and an empty draft, an admin with MFA.
  const operator = jar(), setup = jar(), admin = jar();
  await api("/api/auth/sign-in/email", { user: operator, method: "POST", body: { email: emails.op, password } });
  await api("/api/auth/sign-in/email", { user: setup, method: "POST", body: { email: emails.admin, password } });
  const { totpURI } = await (await api("/api/auth/two-factor/enable", { user: setup, method: "POST", body: { password, method: "totp" } })).json();
  await api("/api/auth/two-factor/verify-totp", { user: setup, method: "POST", body: { code: totp(totpURI) } });
  await api("/api/auth/sign-in/email", { user: admin, method: "POST", body: { email: emails.admin, password } });
  await new Promise(r => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500)); // each TOTP code once
  if ((await api("/api/auth/two-factor/verify-totp", { user: admin, method: "POST", body: { code: totp(totpURI) } })).status !== 200) throw new Error("admin MFA sign-in failed");
  const draft = (await (await api("/api/drafts", { user: operator, method: "POST" })).json()).draft;
  await api(`/api/drafts/${draft.id}`, { user: operator, method: "PATCH", body: { version: draft.version, data } });
  for (const kind of ["METEO", "CHEMICAL"]) {
    const bytes = Buffer.from(`fictional ${kind} evidence\n`), filename = `${kind.toLowerCase()}.txt`;
    const reserved = await (await api(`/api/drafts/${draft.id}/evidence`, { user: operator, method: "POST", body: { kind, filename, contentType: "text/plain",
      sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } })).json();
    uploaded.push(reserved.file.id);
    const form = new FormData(); for (const [k, v] of Object.entries(reserved.upload.fields)) form.append(k, v);
    form.append("file", new Blob([bytes], { type: "text/plain" }), filename);
    await fetch(reserved.upload.url, { method: "POST", body: form });
    await api(`/api/drafts/${draft.id}/evidence/${reserved.file.id}/complete`, { user: operator, method: "POST" });
  }
  const version = (await (await api(`/api/drafts/${draft.id}`, { user: operator })).json()).draft.version;
  if ((await api(`/api/passports/${draft.id}/submit`, { user: operator, method: "POST", body: { version } })).status !== 200) throw new Error("fixture submission failed");
  await api("/api/drafts", { user: operator, method: "POST" });

  browser = engine === "chromium"
    ? await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }) })
    : await playwright[engine].launch({ headless: true });
  const cookiesFor = user => [...user.cookies].map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: "/", httpOnly: true, secure: !!tlsDir, sameSite: "Lax" }));
  for (const [width, height, size] of [[1280, 900, "desktop"], [390, 844, "mobile"]]) {
    for (const locale of ["uk", "en"]) {
      const t = locale === "uk" ? uk : en, label = `${size}/${locale}`;
      const context = async user => {
        const created = await browser.newContext({ ignoreHTTPSErrors: !!tlsDir, viewport: { width, height }, ...(size === "mobile" && engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}) });
        if (user) await created.addCookies(cookiesFor(user));
        await created.addInitScript(value => { try { localStorage.setItem("hartolit-locale", value); } catch { /* storage blocked */ } }, locale);
        return created.newPage();
      };
      const anonymous = await context();
      for (const route of ["/login", "/forgot-password", "/reset-password?token=fictional-invalid", "/passports/1", "/no-such-page"]) {
        await anonymous.goto(base + route); await anonymous.waitForLoadState("networkidle");
        await audit(anonymous, `${label} ${route}`);
        note(await anonymous.evaluate(() => document.documentElement.lang) === locale, `${label} ${route}: page language`);
        if (route === "/login" && size === "desktop") await keyboard(anonymous, `${label} ${route}`, 15);
      }
      const home = await context(operator);
      await home.goto(`${base}/`); await home.waitForLoadState("networkidle");
      await audit(home, `${label} operator home`);
      for (const section of ["farmer", "treatment", "meteo", "chemical"]) {
        const button = home.getByRole("button", { name: new RegExp(t[section].blockTitle) }).first();
        if (await button.count() && await button.getAttribute("aria-expanded") !== "true") await button.click();
      }
      await home.mouse.move(0, 0); await home.waitForTimeout(1000); // colour transitions finish
      await audit(home, `${label} operator draft expanded`);
      if (size === "desktop") await keyboard(home, `${label} operator draft`, 60);
      await home.screenshot({ path: path.join(out, `${size}-${locale}-operator.png`), fullPage: true });
      for (const route of ["/settings/security", "/feedback", "/help"]) { await home.goto(base + route); await home.waitForLoadState("networkidle"); await audit(home, `${label} operator ${route}`); }
      const adminPage = await context(admin);
      await adminPage.goto(`${base}/admin`); await adminPage.waitForLoadState("networkidle");
      await audit(adminPage, `${label} admin overview`);
      await adminPage.screenshot({ path: path.join(out, `${size}-${locale}-admin-overview.png`), fullPage: true });
      if (size === "desktop") await keyboard(adminPage, `${label} admin overview`, 30);
      else {
        await adminPage.getByRole("button", { name: t.adminShell.menu }).click();
        await adminPage.getByRole("dialog", { name: t.adminShell.sections }).waitFor();
        await audit(adminPage, `${label} admin menu`);
        await adminPage.keyboard.press("Escape");
      }
      await adminPage.goto(`${base}/admin/passports`); await adminPage.waitForLoadState("networkidle");
      await audit(adminPage, `${label} admin queue`);
      await adminPage.screenshot({ path: path.join(out, `${size}-${locale}-admin-queue.png`), fullPage: true });
      const row = adminPage.locator("li").filter({ hasText: "Fictional A11y Farm" });
      if (await row.count()) {
        await row.first().getByRole("link").first().click();
        for (const tab of ["data", "evidence", "publication", "history"]) {
          await adminPage.getByRole("tab", { name: t.adminShell.tabs[tab] }).click();
          if (tab === "evidence") await adminPage.getByRole("region", { name: t.holds.title }).waitFor({ timeout: 15_000 });
          await adminPage.waitForTimeout(300);
          await audit(adminPage, `${label} admin detail ${tab}`);
          if (tab === "data") await adminPage.screenshot({ path: path.join(out, `${size}-${locale}-admin-detail.png`), fullPage: true });
        }
      } else note(false, `${label}: the admin queue lists the submitted record`);
      for (const [route, name] of [["farmers", "farmers"], ["fields", "fields"], ["users", "users"], ["publications", "publications"], ["audit", "audit"], ["admin-actions", "adminActions"]]) {
        const tab = t.adminShell.items[name];
        await adminPage.goto(`${base}/admin/${route}`); await adminPage.waitForLoadState("networkidle"); await adminPage.waitForTimeout(800);
        await audit(adminPage, `${label} admin register ${tab}`);
        const raw = (await adminPage.locator("main").innerText()).match(/\b[A-Z]{3,}(?:_[A-Z]+)+\b|\b(?:ACTIVE|ARCHIVED|BANNED)\b|\d+ (?:fields|passports)\b/g) ?? [];
        note(raw.length === 0, `${label} register ${tab}: stored codes shown as words (${[...new Set(raw)].slice(0, 5).join(", ")})`);
      }
      await adminPage.goto(`${base}/admin/feedback`); await adminPage.waitForLoadState("networkidle");
      await audit(adminPage, `${label} admin feedback`);
      await adminPage.goto(`${base}/admin/help`); await adminPage.waitForLoadState("networkidle");
      await audit(adminPage, `${label} admin help`);
      await adminPage.screenshot({ path: path.join(out, `${size}-${locale}-admin-help.png`) });
      for (const opened of browser.contexts()) await opened.close();
    }
  }
  // Text at 200% (WCAG 1.4.4) with reduced motion on a narrow window.
  const zoom = await browser.newContext({ ignoreHTTPSErrors: !!tlsDir, viewport: { width: 640, height: 900 }, reducedMotion: "reduce" });
  await zoom.addCookies(cookiesFor(operator));
  const zoomed = await zoom.newPage(); await zoomed.goto(`${base}/`); await zoomed.waitForLoadState("networkidle");
  await zoomed.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const overflow = await zoomed.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  note(overflow <= 0, `text at 200% in a 640px window: no horizontal overflow (${overflow}px)`);
} catch (error) {
  note(false, `aborted: ${error.message.split("\n")[0]}`);
} finally {
  await browser?.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  if (server?.pid && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  const objectKeys = (await db.evidenceFile.findMany({ where: { id: { in: uploaded } }, select: { objectKey: true } })).map(file => file.objectKey);
  for (const email of Object.values(emails)) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    for (const passport of await db.passport.findMany({ where: { ownerId: user.id }, select: { id: true, farmerId: true, fieldId: true } })) {
      for (const model of ["auditLog", "evidenceFile", "chemicalApplication", "meteoMeasurement", "treatment", "draftRetentionNotice"]) await db[model].deleteMany({ where: { passportId: passport.id } });
      await db.passport.delete({ where: { id: passport.id } });
      await db.field.deleteMany({ where: { id: passport.fieldId } }); await db.farmer.deleteMany({ where: { id: passport.farmerId } });
    }
    await db.field.deleteMany({ where: { ownerId: user.id } }); await db.farmer.deleteMany({ where: { ownerId: user.id } });
  }
  await db.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  for (const key of objectKeys) await s3.send(new DeleteObjectCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET, Key: key }));
  const newKeys = (await db.rateLimit.findMany({ select: { key: true } })).map(row => row.key).filter(key => !rateKeysBefore.has(key));
  await db.rateLimit.deleteMany({ where: { key: { in: newKeys } } });
  await db.$disconnect();
  const detail = [...summary].sort().map(([key, entry]) => `${key}: ${entry.help}\n    pages: ${[...entry.pages].join("; ")}\n    ${[...entry.targets].join("\n    ")}`).join("\n");
  await writeFile(path.join(out, "axe-summary.txt"), detail);
  process.stdout.write(`${findings.join("\n")}\n${detail ? `\nViolations:\n${detail}\n` : ""}Screenshots and summary: ${out}\n`);
}
