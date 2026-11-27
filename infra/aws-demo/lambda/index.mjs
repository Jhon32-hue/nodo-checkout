import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createStaticHandler } from "./static-handler.mjs";

// AWS SDK v3 is included in the managed Lambda Node.js runtime.
const s3 = new S3Client({ maxAttempts: 2 });
const bucket = process.env.SPA_BUCKET;

export const handler = createStaticHandler((key) =>
  s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
);
