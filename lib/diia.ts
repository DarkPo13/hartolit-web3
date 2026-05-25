/**
 * Diia.Signature integration stub.
 *
 * Until production credentials are approved, this module runs a mock flow that
 * matches the shape of the real Diia API responses. Swap `mockSign` /
 * `mockVerify` for real HTTP calls once DIIA_API_KEY / DIIA_API_SECRET land in
 * the env, then point `signWithDiia` at them.
 */

import type {
  DiiaSignRequest,
  DiiaSignResponse,
  DiiaVerifyRequest,
  DiiaVerifyResponse,
} from "@/types/diia";
import { sha256Hex } from "./hash";

const MOCK_SESSIONS = new Map<
  string,
  {
    request: DiiaSignRequest;
    createdAt: number;
    autoSignAfterMs: number;
  }
>();

export async function signWithDiia(req: DiiaSignRequest): Promise<DiiaSignResponse> {
  const apiKey = process.env.DIIA_API_KEY;
  if (apiKey) {
    return realSign(req);
  }
  return mockSign(req);
}

export async function verifyDiiaSignature(req: DiiaVerifyRequest): Promise<DiiaVerifyResponse> {
  const apiKey = process.env.DIIA_API_KEY;
  if (apiKey) {
    return realVerify(req);
  }
  return mockVerify(req);
}

// ---------------------------------------------------------------------------
// Mock implementation (for dev until Diia credentials are approved)
// ---------------------------------------------------------------------------

async function mockSign(req: DiiaSignRequest): Promise<DiiaSignResponse> {
  const sessionId = `mock-${crypto.randomUUID()}`;
  MOCK_SESSIONS.set(sessionId, {
    request: req,
    createdAt: Date.now(),
    autoSignAfterMs: 1500,
  });
  return {
    sessionId,
    deeplink: `diia://sign?session=${sessionId}`,
    qrCode: `mock-qr-${sessionId}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

async function mockVerify(req: DiiaVerifyRequest): Promise<DiiaVerifyResponse> {
  const session = MOCK_SESSIONS.get(req.sessionId);
  if (!session) {
    return { status: "expired" };
  }
  const elapsed = Date.now() - session.createdAt;
  if (elapsed < session.autoSignAfterMs) {
    return { status: "pending" };
  }

  const keyId = `KEP-${(await sha256Hex(req.sessionId)).slice(0, 16).toUpperCase()}`;
  const sigHash = await sha256Hex(`${session.request.documentSha256}:${req.sessionId}`);

  return {
    status: "signed",
    signature: {
      keyId,
      signerName: session.request.signerName,
      signerEdrpou: session.request.signerEdrpou,
      timestamp: new Date().toISOString(),
      sha256: sigHash,
      certSerial: `UA-${keyId.slice(-8)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Real Diia API (placeholder — fill in once credentials are approved)
// ---------------------------------------------------------------------------

async function realSign(_req: DiiaSignRequest): Promise<DiiaSignResponse> {
  throw new Error(
    "Real Diia.Signature integration not implemented yet. " +
      "See implementation.md Phase 6 for the OAuth + deeplink flow.",
  );
}

async function realVerify(_req: DiiaVerifyRequest): Promise<DiiaVerifyResponse> {
  throw new Error("Real Diia.Signature verification not implemented yet.");
}
