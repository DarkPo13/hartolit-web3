import nextEnv from "@next/env";
import { HeadBucketCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

nextEnv.loadEnvConfig(process.cwd());
if (process.env.EVIDENCE_S3_ENDPOINT !== "http://127.0.0.1:8333") throw new Error("This script is only for local evidence storage");
const client = new S3Client({
  region: process.env.EVIDENCE_S3_REGION,
  endpoint: process.env.EVIDENCE_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY },
});
await client.send(new HeadBucketCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET }));
await client.send(new PutBucketCorsCommand({
  Bucket: process.env.EVIDENCE_S3_BUCKET,
  CORSConfiguration: { CORSRules: [{
    AllowedMethods: ["GET", "POST"],
    AllowedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
    AllowedHeaders: ["*"],
    MaxAgeSeconds: 300,
  }] },
}));
process.stdout.write("Local private evidence bucket and browser CORS are ready.\n");
