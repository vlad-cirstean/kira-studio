import { CreateBucketCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

// S3 has no .sql-file seeding path either (mirrors 0005_kafka_seed.ts/0006_sqs_seed.ts) — run
// once against a fresh LocalStack instance by support/s3.ts.
export const MAIN_BUCKET = 'main-bucket';
export const EMPTY_BUCKET = 'empty-bucket'; // exercises a bucket with zero objects
// A nested key so the tree's '/'-splitting has more than one level to prove out (a root-level
// object, one under one prefix, one two prefixes deep — all sharing the "reports/" ancestor so
// listPrefixChildren's own CommonPrefixes grouping has something real to group).
export const ROOT_OBJECT_KEY = 'readme.txt';
export const ROOT_OBJECT_BODY = 'hello from the bucket root';
export const NESTED_OBJECT_KEY = 'reports/2024/summary.json';
export const NESTED_OBJECT_BODY = JSON.stringify({ year: 2024, total: 42 });
export const SIBLING_PREFIX_OBJECT_KEY = 'reports/notes.txt';
export const SIBLING_PREFIX_OBJECT_BODY = 'a sibling of the 2024/ prefix, under reports/ itself';

export async function seedS3(client: S3Client): Promise<void> {
  await client.send(new CreateBucketCommand({ Bucket: MAIN_BUCKET }));
  await client.send(new CreateBucketCommand({ Bucket: EMPTY_BUCKET }));

  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: ROOT_OBJECT_KEY,
      Body: ROOT_OBJECT_BODY,
      ContentType: 'text/plain',
      Metadata: { seeded: 'true' },
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: NESTED_OBJECT_KEY,
      Body: NESTED_OBJECT_BODY,
      ContentType: 'application/json',
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: SIBLING_PREFIX_OBJECT_KEY,
      Body: SIBLING_PREFIX_OBJECT_BODY,
      ContentType: 'text/plain',
    }),
  );
}
