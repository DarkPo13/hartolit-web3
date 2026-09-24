import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

export function evidenceStorage() {
  const bucket = process.env.EVIDENCE_S3_BUCKET;
  const region = process.env.EVIDENCE_S3_REGION;
  if (!bucket || !region) throw new Error("Evidence storage is not configured");
  if (!client) {
    const endpoint = process.env.EVIDENCE_S3_ENDPOINT || undefined;
    const accessKeyId = process.env.EVIDENCE_S3_ACCESS_KEY;
    const secretAccessKey = process.env.EVIDENCE_S3_SECRET_KEY;
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error("Incomplete evidence storage credentials");
    client = new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }
  return { client, bucket };
}
