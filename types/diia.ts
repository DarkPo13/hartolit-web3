export type DiiaSignerRole = "pilot" | "supplier";

export interface DiiaSignRequest {
  role: DiiaSignerRole;
  documentSha256: string;
  documentFilename: string;
  signerName: string;
  signerEdrpou?: string;
}

export interface DiiaSignResponse {
  sessionId: string;
  deeplink: string;
  qrCode: string;
  expiresAt: string;
}

export interface DiiaVerifyRequest {
  sessionId: string;
}

export interface DiiaVerifyResponse {
  status: "pending" | "signed" | "rejected" | "expired";
  signature?: {
    keyId: string;
    signerName: string;
    signerEdrpou?: string;
    timestamp: string;
    sha256: string;
    certSerial?: string;
  };
}
