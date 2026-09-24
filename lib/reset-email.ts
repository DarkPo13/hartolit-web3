import nodemailer from "nodemailer";

export function isResetEmailConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT);
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_FROM &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535 &&
    !!process.env.SMTP_USER === !!process.env.SMTP_PASSWORD
  );
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
