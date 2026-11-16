import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createJiti } from "jiti";

process.env.BETTER_AUTH_SECRET = "fictional-test-secret-0123456789abcdef0123456789";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/"),
  "server-only": path.resolve("node_modules/next/dist/compiled/server-only/empty.js").replaceAll("\\", "/") } });
const { isPasswordResetAvailable, isResetEmailConfigured, passwordResetDelivery } = await jiti.import("../lib/reset-email.ts");
const outbox = await jiti.import("../lib/password-reset-outbox.ts");

const smtp = { SMTP_HOST: "smtp.example.invalid", SMTP_PORT: "587", SMTP_FROM: "Hartolit <no-reply@example.invalid>" };

test("password reset is offered only with SMTP and someone who delivers after the response", () => {
  assert.equal(passwordResetDelivery({}), "inline", "a long-running server delivers after the response");
  assert.equal(passwordResetDelivery({ HARTOLIT_PASSWORD_RESET_WORKER: "external" }), "external");
  assert.equal(passwordResetDelivery({ AWS_LAMBDA_FUNCTION_NAME: "server" }), null, "Lambda has no reliable work after the response");
  assert.equal(passwordResetDelivery({ AWS_LAMBDA_FUNCTION_NAME: "server", HARTOLIT_PASSWORD_RESET_WORKER: "external" }), "external");
  for (const value of ["inline", "true", "External", "sqs"]) assert.equal(passwordResetDelivery({ HARTOLIT_PASSWORD_RESET_WORKER: value }), null, value);
  assert.equal(isPasswordResetAvailable({}), false, "no SMTP: off");
  assert.equal(isPasswordResetAvailable(smtp), true);
  assert.equal(isPasswordResetAvailable({ ...smtp, AWS_LAMBDA_FUNCTION_NAME: "server" }), false, "SMTP on Lambda without a worker: off");
  assert.equal(isPasswordResetAvailable({ ...smtp, AWS_LAMBDA_FUNCTION_NAME: "server", HARTOLIT_PASSWORD_RESET_WORKER: "external" }), true);
  assert.equal(isResetEmailConfigured({ ...smtp, SMTP_USER: "user" }), false, "a user without a password is incomplete");
  assert.equal(isResetEmailConfigured({ ...smtp, SMTP_PORT: "70000" }), false);
});

test("a queued link is sealed with the auth secret and bound to its row", async () => {
  const id = randomUUID(), link = "https://staging.example.invalid/reset-password/AbCdEfGhIjKlMnOpQrStUvWx?callbackURL=";
  const sealed = await outbox.sealResetLink(id, link);
  assert.ok(!sealed.includes("reset-password") && !sealed.includes("AbCdEf"), "the stored value does not show the link");
  assert.equal(await outbox.unsealResetLink(id, sealed), link);
  await assert.rejects(outbox.unsealResetLink(randomUUID(), sealed), /another row/, "a row cannot borrow another row's link");
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === "0" ? "1" : "0") + sealed.at(-1);
  await assert.rejects(outbox.unsealResetLink(id, flipped), "a changed ciphertext is refused");
  const saved = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = "another-fictional-secret-0123456789abcdef012345";
  try { await assert.rejects(outbox.unsealResetLink(id, sealed), "another secret cannot open it"); }
  finally { process.env.BETTER_AUTH_SECRET = saved; }
});

test("logs get only an error class and a constant code", () => {
  const smtpError = Object.assign(new Error("Connection refused for someone@example.invalid"), { code: "ECONNECTION" });
  assert.equal(outbox.safeErrorLabel(smtpError), "Error ECONNECTION");
  const leaky = Object.assign(new TypeError("https://x.invalid/reset-password/secret"), { code: "someone@example.invalid" });
  assert.equal(outbox.safeErrorLabel(leaky), "TypeError");
  assert.equal(outbox.safeErrorLabel("someone@example.invalid"), "unknown");
});

test("retries stay inside the link's hour and an attempt ends inside its lease", () => {
  assert.equal(outbox.RESET_LINK_SECONDS, 3600);
  assert.equal(outbox.OUTBOX_RETRY_SECONDS.length, outbox.OUTBOX_MAX_ATTEMPTS - 1);
  assert.ok(outbox.OUTBOX_RETRY_SECONDS.every((seconds, i, all) => i === 0 || seconds > all[i - 1]), "backoff grows");
  assert.ok(outbox.OUTBOX_RETRY_SECONDS.reduce((a, b) => a + b, 0) < outbox.RESET_LINK_SECONDS, "every retry happens before the link expires");
  assert.ok(outbox.OUTBOX_LEASE_SECONDS > 10 + 10 + 20, "connection, greeting and socket timeouts fit in the lease");
});
