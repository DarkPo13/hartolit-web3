// Run daily in the hosted environment. Dry run by default; --execute deletes stale quarantine objects.
import nextEnv from "@next/env";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createJiti } from "jiti";

nextEnv.loadEnvConfig(process.cwd());
const execute = process.argv.includes("--execute");
if (!process.env.DATABASE_URL || !process.env.EVIDENCE_S3_BUCKET || !process.env.EVIDENCE_S3_REGION) throw new Error("Database and evidence bucket must be configured");
if (Boolean(process.env.EVIDENCE_S3_ACCESS_KEY) !== Boolean(process.env.EVIDENCE_S3_SECRET_KEY)) throw new Error("Incomplete evidence storage credentials");
const jiti = createJiti(import.meta.url);
const { getDb } = await jiti.import("../lib/db-core.ts");
const db = getDb();
const client = new S3Client({
  region: process.env.EVIDENCE_S3_REGION,
  endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined,
  forcePathStyle: Boolean(process.env.EVIDENCE_S3_ENDPOINT),
  credentials: process.env.EVIDENCE_S3_ACCESS_KEY ? { accessKeyId: process.env.EVIDENCE_S3_ACCESS_KEY, secretAccessKey: process.env.EVIDENCE_S3_SECRET_KEY } : undefined,
});
const now = Date.now();
const pendingBefore = new Date(now - 24 * 60 * 60 * 1000);
const quarantineBefore = new Date(now - 7 * 24 * 60 * 60 * 1000);
const rejectedBefore = new Date(now - 60 * 60 * 1000);
let lastId;
let count = 0;
try {
  while (true) {
    const rows = await db.evidenceFile.findMany({
      where: {
        ...(lastId ? { id: { gt: lastId } } : {}),
        objectPurgedAt: null,
        OR: [
          { status: "PENDING", uploadExpiresAt: { lt: pendingBefore } },
          { status: "QUARANTINED", updatedAt: { lt: quarantineBefore } },
          { status: "SCANNING", scanLeaseUntil: { lt: quarantineBefore } },
          { status: "REJECTED", updatedAt: { lt: rejectedBefore } },
        ],
      },
      select: { id: true, objectKey: true, status: true },
      orderBy: { id: "asc" }, take: 100,
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (execute) {
        await client.send(new DeleteObjectCommand({ Bucket: process.env.EVIDENCE_S3_BUCKET, Key: row.objectKey }));
        await db.evidenceFile.updateMany({ where: { id: row.id, status: row.status, objectPurgedAt: null }, data: { status: "REJECTED", ...(row.status === "REJECTED" ? {} : { rejectionCode: "EXPIRED" }), scanLeaseUntil: null, objectPurgedAt: new Date() } });
      }
      count++;
    }
    lastId = rows.at(-1).id;
  }
  process.stdout.write(`${execute ? "Pruned" : "Would prune"} ${count} stale evidence object(s).\n`);
} finally {
  client.destroy();
  await db.$disconnect();
}
