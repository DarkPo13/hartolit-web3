import { createHmac, timingSafeEqual } from "node:crypto";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";
import { getDb } from "./db-core";

// Better Auth accepts the codes of the previous, current and next 30-second step.
const PERIOD_SECONDS = 30, WINDOW = 1;

function hotp(key: Buffer, counter: bigint) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest.readUInt8(digest.length - 1) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// The user is the signed-in one while enrolling, otherwise the one behind the pending
// sign-in cookie, resolved the same way the two-factor plugin does.
async function totpUserId(ctx: Ctx) {
  const session = await getSessionFromCtx(ctx);
  if (session) return session.user.id;
  const cookie = ctx.context.createAuthCookie("two_factor");
  const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!signed) return null;
  return (await ctx.context.internalAdapter.findVerificationValue(signed))?.value ?? null;
}

/** RFC 6238 section 5.2: a code is accepted only for a time step newer than the
 * user's last accepted one, so the same code cannot complete a second sign-in.
 * Wrong codes pass through unchanged; Better Auth rejects and counts them.
 */
export const refuseReusedTotp = createAuthMiddleware(async ctx => {
  if (ctx.path !== "/two-factor/verify-totp") return;
  const code = typeof ctx.body?.code === "string" ? ctx.body.code : "";
  if (!/^\d{6}$/.test(code)) return;
  const userId = await totpUserId(ctx);
  if (!userId) return;
  const db = getDb();
  const row = await db.twoFactor.findFirst({ where: { userId }, select: { secret: true } });
  if (!row) return;
  const key = Buffer.from(await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret }), "utf8");
  const now = BigInt(Math.floor(Date.now() / (PERIOD_SECONDS * 1000)));
  let step: bigint | null = null;
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    if (timingSafeEqual(Buffer.from(hotp(key, now + BigInt(offset))), Buffer.from(code))) step = now + BigInt(offset);
  }
  if (step === null) return;
  const claimed = await db.$executeRaw`
    INSERT INTO "TwoFactorReplayGuard" ("userId", "lastStep", "updatedAt") VALUES (${userId}, ${step}, now())
    ON CONFLICT ("userId") DO UPDATE SET "lastStep" = EXCLUDED."lastStep", "updatedAt" = now()
    WHERE "TwoFactorReplayGuard"."lastStep" < EXCLUDED."lastStep"`;
  if (claimed === 0) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_CODE);
});
