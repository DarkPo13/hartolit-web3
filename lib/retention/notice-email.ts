import "server-only";

import nodemailer from "nodemailer";
import { isResetEmailConfigured } from "@/lib/reset-email";

/** Notice to the draft owner; contains no draft content, only its creation date. */
export async function sendDraftRetentionEmail(to: string, createdAt: Date, deleteAfter: Date): Promise<void> {
  if (!isResetEmailConfigured()) throw new Error("Retention notice email is not configured");
  const port = Number(process.env.SMTP_PORT);
  const username = process.env.SMTP_USER, password = process.env.SMTP_PASSWORD;
  const app = new URL("/", process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString();
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    requireTLS: process.env.NODE_ENV === "production" && port !== 465, auth: username && password ? { user: username, pass: password } : undefined });
  const day = (value: Date) => value.toISOString().slice(0, 10);
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM, to,
      subject: "Hartolit: unsubmitted draft will be deleted / чернетку буде видалено",
      text: `Your Hartolit draft created on ${day(createdAt)} was never submitted and has not changed for 90 days. ` +
        `It and its attachments will be deleted after ${day(deleteAfter)} unless you open and edit it before then:\n\n${app}\n\n` +
        `Вашу чернетку Hartolit, створену ${day(createdAt)}, ніколи не подавали, і вона не змінювалася 90 днів. ` +
        `Її та вкладення буде видалено після ${day(deleteAfter)}, якщо до того часу ви її не відкриєте й не зміните.\n` });
  } finally { transport.close(); }
}
