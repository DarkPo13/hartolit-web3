import nodemailer from "nodemailer";

type Env = Record<string, string | undefined>;

export function isResetEmailConfigured(env: Env = process.env): boolean {
  const port = Number(env.SMTP_PORT);
  return !!(
    env.SMTP_HOST &&
    env.SMTP_FROM &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    !!env.SMTP_USER === !!env.SMTP_PASSWORD
  );
}

/**
 * Who sends queued password reset and invitation emails (D81). `inline`: this server, right
 * after the response (a long-running `next start`). `external`: a separate worker running
 * `npm run mail:outbox` or its AWS equivalent. AWS Lambda gives no reliable work after the
 * response, so there only `external` is accepted. An unknown value switches the feature off.
 */
export function passwordResetDelivery(env: Env = process.env): "inline" | "external" | null {
  const mode = env.HARTOLIT_PASSWORD_RESET_WORKER?.trim() ?? "";
  if (mode === "external") return "external";
  if (mode) return null;
  return env.AWS_LAMBDA_FUNCTION_NAME ? null : "inline";
}

/** Password reset and invitations are offered only when SMTP is set and someone will deliver. */
export function isPasswordResetAvailable(env: Env = process.env): boolean {
  return isResetEmailConfigured(env) && passwordResetDelivery(env) !== null;
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  if (!isResetEmailConfigured()) throw new Error("Password reset email is not configured");

  const expectedOrigin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
  if (new URL(url).origin !== expectedOrigin) throw new Error("Unexpected password reset URL");

  const port = Number(process.env.SMTP_PORT);
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: process.env.NODE_ENV === "production" && port !== 465,
    auth: username && password ? { user: username, pass: password } : undefined,
    // Nodemailer waits up to 2 minutes to connect and 10 minutes on a stalled socket by
    // default; a delivery attempt must end well inside the outbox lease (120 s).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Reset your Hartolit password",
      text: `Use this link to reset your Hartolit password. It expires in one hour:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    });
  } finally {
    transport.close();
  }
}
