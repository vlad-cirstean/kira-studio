import { CreateBucketCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { OBJECT_BODY_PREVIEW_BYTES } from '@shared/protocol/page';

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

// P33 D14: read-only ladder objects, under their own prefix — scenario 5 asserts only the
// *bucket root* listing, so these never perturb it, and no mutating scenario ever touches them.
export const SMALL_FOR_COUNT_KEY = 'sizes/small-for-count.txt';
export const SMALL_FOR_COUNT_BODY = 'a small object, used only as the count() comparison baseline';
// Sized relative to the real shared threshold (not a hardcoded number) so this fixture tracks any
// future change to OBJECT_BODY_PREVIEW_BYTES automatically.
export const OVERSIZED_OBJECT_KEY = 'sizes/oversized.bin';
export const OVERSIZED_OBJECT_BYTES = OBJECT_BODY_PREVIEW_BYTES + 1024;
// A real, tiny PNG (1x1, transparent) — under the preview limit so it renders, but its bytes are
// not valid UTF-8 (tests/ui/s3.spec.ts's binary-object scenario), same fixture seed.sh embeds by
// hand for the demo bucket.
export const BINARY_OBJECT_KEY = 'sizes/logo.png';
export const BINARY_OBJECT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// P33 D14: a dedicated bucket for every mutating scenario (update/insert/delete), so scenarios
// 5/6/9/10/11/13 — which assert MAIN_BUCKET's exact listings/bodies — never become order-
// dependent on a scenario that writes to it (F24: one memoized LocalStack container serves the
// whole file).
export const MUTABLE_BUCKET = 'mutable-bucket';
export const EDITABLE_OBJECT_KEY = 'editable.json';
export const EDITABLE_OBJECT_BODY = JSON.stringify({ status: 'draft' });
export const READONLY_TARGET_KEY = 'readonly-target.txt';
export const READONLY_TARGET_BODY = 'must not change if a read-only connection tries to edit it';
export const DELETE_TARGET_KEY = 'delete-target.txt';
export const DELETE_TARGET_BODY = 'this object exists only to be deleted';
// A second, independent delete target — tests/ui/s3.spec.ts's delete scenario removes one object
// from a tree row and a different one from an open tab in the same test, so each needs its own key.
export const SECOND_DELETE_TARGET_KEY = 'second-delete-target.txt';
export const SECOND_DELETE_TARGET_BODY =
  'a second object, deleted from an open tab instead of the tree';
// Never pre-seeded — scenario 23 (mutate insert) creates this key itself and scenario 24 asserts
// a *different*, still-nonexistent key is never created by a refused insert.
export const UPLOAD_TARGET_KEY = 'uploaded-from-disk.txt';

export async function seedS3(client: S3Client): Promise<void> {
  await client.send(new CreateBucketCommand({ Bucket: MAIN_BUCKET }));
  await client.send(new CreateBucketCommand({ Bucket: EMPTY_BUCKET }));
  await client.send(new CreateBucketCommand({ Bucket: MUTABLE_BUCKET }));

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
  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: SMALL_FOR_COUNT_KEY,
      Body: SMALL_FOR_COUNT_BODY,
      ContentType: 'text/plain',
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: OVERSIZED_OBJECT_KEY,
      Body: 'x'.repeat(OVERSIZED_OBJECT_BYTES),
      ContentType: 'text/plain',
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MAIN_BUCKET,
      Key: BINARY_OBJECT_KEY,
      Body: Buffer.from(BINARY_OBJECT_BASE64, 'base64'),
      ContentType: 'image/png',
    }),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: MUTABLE_BUCKET,
      Key: EDITABLE_OBJECT_KEY,
      Body: EDITABLE_OBJECT_BODY,
      ContentType: 'application/json',
      Metadata: { seeded: 'true' },
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MUTABLE_BUCKET,
      Key: READONLY_TARGET_KEY,
      Body: READONLY_TARGET_BODY,
      ContentType: 'text/plain',
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MUTABLE_BUCKET,
      Key: DELETE_TARGET_KEY,
      Body: DELETE_TARGET_BODY,
      ContentType: 'text/plain',
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: MUTABLE_BUCKET,
      Key: SECOND_DELETE_TARGET_KEY,
      Body: SECOND_DELETE_TARGET_BODY,
      ContentType: 'text/plain',
    }),
  );
}
