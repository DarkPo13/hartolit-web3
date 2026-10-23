import "server-only";

import QRCode from "qrcode";

export type PublicShare = { url: string; qrDataUrl: string };

/** Share URL and QR from the configured application origin only, never from the
 * request Host header, so a forged Host cannot produce a QR to another domain.
 */
export async function publicPassportShare(tokenId: string, origin = process.env.BETTER_AUTH_URL): Promise<PublicShare | null> {
  if (!/^[1-9][0-9]{0,77}$/.test(tokenId)) return null;
  let base;
  try { base = new URL(origin ?? ""); } catch { return null; }
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password) return null;
  const url = new URL(`/passports/${tokenId}`, base.origin).toString();
  return { url, qrDataUrl: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 240 }) };
}
