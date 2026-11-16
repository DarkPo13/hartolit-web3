import { randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getDb } from "./db-core";
import { isResetEmailConfigured, passwordResetDelivery, sendPasswordResetEmail } from "./reset-email";

// Password reset and invitation emails go through a durable outbox (D81). The request only
// writes one row, for an unknown address too (a decoy), so its timing does not depend on
// whether the account exists, and no email is sent while the client waits. Delivery runs
// after the response on a long-running server, or in a separate worker on AWS Lambda.

/** Better Auth's `resetPasswordTokenExpiresIn`: a queued link is useless after this. */
export const RESET_LINK_SECONDS = 60 * 60;
export const OUTBOX_BATCH = 10;
export const OUTBOX_LEASE_SECONDS = 120;
export const OUTBOX_MAX_ATTEMPTS = 5;
/** Wait before attempt n + 1 after attempt n failed (n = 1..4). */
export const OUTBOX_RETRY_SECONDS = [30, 120, 600, 1800] as const;

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// Requests whose handler queued a real email; the after-hook queues a decoy for the rest.
const queued = new WeakSet<Request>();

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  return value;
}

/** Only an error's class and code reach the logs: never the address, link or token. */
export function safeErrorLabel(error: unknown) {
  if (!(error instanceof Error)) return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? `${error.name} ${code}` : error.name;
}

/** The link is encrypted with the auth secret and bound to its row id. */
export async function sealResetLink(id: string, link: string) {
  return symmetricEncrypt({ key: secret(), data: `${id}\n${link}` });
}

export async function unsealResetLink(id: string, sealed: string) {
  const plain = await symmetricDecrypt({ key: secret(), data: sealed });
  if (!plain.startsWith(`${id}\n`)) throw new Error("Sealed link belongs to another row");
  return plain.slice(id.length + 1);
}

async function insertRow(userId: string | null, link: string) {
  const id = randomUUID();
  await getDb().passwordResetOutbox.create({ data: { id, userId, linkSealed: await sealResetLink(id, link),
    expiresAt: new Date(Date.now() + RESET_LINK_SECONDS * 1000) } });
}

/** Better Auth's `sendResetPassword`: a durable write, nothing else. */
export async function enqueuePasswordResetEmail(userId: string, link: string, request?: Request) {
  if (request) queued.add(request);
  // Swallowed with a safe label: Better Auth would otherwise log the whole error, and the
  // client must get the same answer as for an unknown address.
  try { await insertRow(userId, link); }
  catch (error) { console.error("Password reset email could not be queued", safeErrorLabel(error)); }
}

function decoyLink(baseURL: string, redirectTo: unknown) {
  // Shaped like Better Auth's link so the sealed value has the same length.
  const token = Array.from(randomBytes(24), (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join("");
  const callback = typeof redirectTo === "string" && redirectTo ? encodeURIComponent(redirectTo) : "";
  return `${baseURL}/reset-password/${token}?callbackURL=${callback}`;
}

function scheduleInlineDelivery() {
  if (passwordResetDelivery() !== "inline" || !isResetEmailConfigured()) return;
  try {
    after(async () => {
      try { await drainPasswordResetOutbox(); }
      catch (error) { console.error("Password reset outbox delivery failed", safeErrorLabel(error)); }
    });
  } catch {
    // Outside a Next request (a script): `npm run mail:outbox` delivers.
  }
}

/** After every reset request that Better Auth answered with success: a decoy row when no
 * real one was written, then delivery after the response when this server delivers. */
export const afterPasswordResetRequest = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/request-password-reset" || ctx.context.returned instanceof Error) return;
  const request = ctx.request;
  if (request && !queued.has(request)) {
    try { await insertRow(null, decoyLink(ctx.context.baseURL, (ctx.body as { redirectTo?: unknown } | undefined)?.redirectTo)); }
    catch (error) { console.error("Password reset email could not be queued", safeErrorLabel(error)); }
  }
  scheduleInlineDelivery();
});

type Claimed = { id: string; userId: string | null; linkSealed: string; expiresAt: Date; attempts: number };
export type DrainCounts = { sent: number; retried: number; gaveUp: number; expired: number; decoys: number; discarded: number };

/**
 * Sends due emails once. Rows are claimed with a lease (`FOR UPDATE SKIP LOCKED`), so
 * parallel workers never send the same row; a crash after sending can repeat an email
 * (at least once). A sent, decoy, expired, undecryptable or given-up row is deleted.
 */
export async function drainPasswordResetOutbox({ limit = OUTBOX_BATCH }: { limit?: number } = {}): Promise<DrainCounts> {
  const counts: DrainCounts = { sent: 0, retried: 0, gaveUp: 0, expired: 0, decoys: 0, discarded: 0 };
  if (!isResetEmailConfigured()) return counts;
  const db = getDb();
  // Rows nobody can use any more, including ones a crashed worker left at the attempt limit.
  counts.expired += await db.$executeRaw`DELETE FROM "PasswordResetOutbox"
    WHERE "expiresAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())`;
  counts.gaveUp += await db.$executeRaw`DELETE FROM "PasswordResetOutbox"
    WHERE "attempts" >= ${OUTBOX_MAX_ATTEMPTS} AND ("leaseUntil" IS NULL OR "leaseUntil" < now())`;
  const rows = await db.$queryRaw<Claimed[]>`UPDATE "PasswordResetOutbox"
    SET "leaseUntil" = now() + ${OUTBOX_LEASE_SECONDS} * interval '1 second', "attempts" = "attempts" + 1
    WHERE "id" IN (SELECT "id" FROM "PasswordResetOutbox"
      WHERE "nextAttemptAt" <= now() AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
      ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id", "userId", "linkSealed", "expiresAt", "attempts"`;
  for (const row of rows) {
    const remove = () => db.passwordResetOutbox.deleteMany({ where: { id: row.id } });
    if (!row.userId) { await remove(); counts.decoys++; continue; }
    if (row.expiresAt.getTime() <= Date.now()) { await remove(); counts.expired++; continue; }
    const user = await db.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    let link: string | null = null;
    try { link = await unsealResetLink(row.id, row.linkSealed); } catch { link = null; }
    if (!user || !link) { await remove(); counts.discarded++; continue; }
    try {
      await sendPasswordResetEmail(user.email, link);
      await remove(); counts.sent++;
    } catch (error) {
      console.error("Password reset email delivery failed", safeErrorLabel(error));
      if (row.attempts >= OUTBOX_MAX_ATTEMPTS) { await remove(); counts.gaveUp++; continue; }
      const wait = OUTBOX_RETRY_SECONDS[Math.min(row.attempts, OUTBOX_RETRY_SECONDS.length) - 1] ?? OUTBOX_RETRY_SECONDS[0];
      await db.passwordResetOutbox.updateMany({ where: { id: row.id },
        data: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + wait * 1000) } });
      counts.retried++;
    }
  }
  return counts;
}
