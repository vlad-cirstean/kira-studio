import {
  DeleteObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import {
  OBJECT_CONTENT_TYPE_SENTINEL,
  OBJECT_FILE_SENTINEL,
  OBJECT_KEY_SENTINEL,
  OBJECT_VALUE_SENTINEL,
} from '../../../shared/domain/object-store';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapS3Error } from './errors';
import { formatBytes } from './read';
import { openUploadBody } from './transfer';

// P33 D2/F10: edit, delete and upload ride the existing mutate() path with the same
// sentinel-through-MutationRowOp technique redis/mutate.ts established — _key names the target
// object, on top of which S3 needs $file/$contentType for an upload (a local file path is not a
// column value). Only download has no shape MutationPlan can express (it returns no rows and
// mutates nothing), so it alone gets a new Adapter method (P33 commit 3).

function resolveBucketSegment(path: MutationPlan['path']): string {
  const [bucketSegment] = path.segments;
  if (bucketSegment?.kind !== 'bucket') {
    throw new AdapterError(
      'E_NOT_FOUND',
      `mutate requires a bucket-rooted path, got: ${encodePath(path.segments)}`,
    );
  }
  return bucketSegment.name;
}

function keyFrom(values: Record<string, string | null>, label: string): string {
  const raw = values[OBJECT_KEY_SENTINEL];
  if (typeof raw !== 'string' || raw === '') {
    throw new AdapterError(
      'E_QUERY',
      `an s3 ${label} mutation requires a non-empty ${OBJECT_KEY_SENTINEL}`,
    );
  }
  return raw;
}

function valueFrom(values: Record<string, string | null>, label: string): string {
  const raw = values[OBJECT_VALUE_SENTINEL];
  if (typeof raw !== 'string') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `an s3 ${label} mutation requires a ${OBJECT_VALUE_SENTINEL}`,
    );
  }
  return raw;
}

function fileFrom(values: Record<string, string | null>): string {
  const raw = values[OBJECT_FILE_SENTINEL];
  if (typeof raw !== 'string' || raw === '') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `an s3 insert mutation requires a non-empty ${OBJECT_FILE_SENTINEL}`,
    );
  }
  return raw;
}

function contentTypeFrom(values: Record<string, string | null>): string | undefined {
  const raw = values[OBJECT_CONTENT_TYPE_SENTINEL];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

// Synchronous (Adapter rule 3), no network call — trusts the plan's shape as given, mirrors
// redis/mutate.ts's own preview(). An insert shows the source path, not a byte count: unlike
// update's $value (already an in-memory string), the file's size is only known after a stat()
// call, which would make this a hidden I/O operation disguised as a pure preview.
export function preview(plan: MutationPlan): string[] {
  const bucket = resolveBucketSegment(plan.path);
  return plan.ops.map((op) => renderOpText(bucket, op));
}

function renderOpText(bucket: string, op: MutationRowOp): string {
  if (op.kind === 'update') {
    const key = keyFrom(op.key, 'update');
    const bytes = new TextEncoder().encode(valueFrom(op.changes, 'update')).length;
    return `PutObject s3://${bucket}/${key} (${formatBytes(bytes)})`;
  }
  if (op.kind === 'delete') {
    return `DeleteObject s3://${bucket}/${keyFrom(op.key, 'delete')}`;
  }
  const key = keyFrom(op.values, 'insert');
  return `PutObject s3://${bucket}/${key} <- ${fileFrom(op.values)}`;
}

// Carries over every attribute HeadObject returns and PutObject accepts (D11) — PutObject
// replaces an object wholesale, so anything not resent here is gone: silently turning
// application/json into binary/octet-stream, or dropping Content-Encoding: gzip, would change
// how the object is served to everything downstream.
function preservedAttributes(head: HeadObjectCommandOutput): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (head.ContentType !== undefined) attrs.ContentType = head.ContentType;
  if (head.CacheControl !== undefined) attrs.CacheControl = head.CacheControl;
  if (head.ContentEncoding !== undefined) attrs.ContentEncoding = head.ContentEncoding;
  if (head.ContentDisposition !== undefined) attrs.ContentDisposition = head.ContentDisposition;
  if (head.ContentLanguage !== undefined) attrs.ContentLanguage = head.ContentLanguage;
  if (head.StorageClass !== undefined) attrs.StorageClass = head.StorageClass;
  if (head.Metadata !== undefined) attrs.Metadata = head.Metadata;
  return attrs;
}

async function applyUpdate(
  client: S3Client,
  ctx: OpCtx,
  bucket: string,
  op: Extract<MutationRowOp, { kind: 'update' }>,
): Promise<void> {
  const key = keyFrom(op.key, 'update');
  const value = valueFrom(op.changes, 'update');
  let head: HeadObjectCommandOutput;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: value,
        ...preservedAttributes(head),
      }),
      { abortSignal: ctx.signal },
    );
  } catch (err) {
    throw mapS3Error(err);
  }
}

async function applyInsert(
  client: S3Client,
  ctx: OpCtx,
  bucket: string,
  op: Extract<MutationRowOp, { kind: 'insert' }>,
): Promise<void> {
  const key = keyFrom(op.values, 'insert');
  // NX-equivalent: HeadObject first — PutObject has no conditional-create option, so this is the
  // only way to refuse a collision (D13) rather than silently overwriting an existing object,
  // which is what Edit is for.
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
    throw new AdapterError('E_QUERY', `key already exists: ${key}`);
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    const mapped = mapS3Error(err);
    if (mapped.code !== 'E_QUERY') throw mapped; // anything but "not found" is a real failure
  }

  const { stream, size } = await openUploadBody(fileFrom(op.values));
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentLength: size,
        ContentType: contentTypeFrom(op.values),
      }),
      { abortSignal: ctx.signal },
    );
  } catch (err) {
    throw mapS3Error(err);
  }
}

async function applyDelete(
  client: S3Client,
  ctx: OpCtx,
  bucket: string,
  op: Extract<MutationRowOp, { kind: 'delete' }>,
): Promise<void> {
  const key = keyFrom(op.key, 'delete');
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }
}

export async function mutate(
  client: S3Client,
  ctx: OpCtx,
  readOnly: boolean,
  plan: MutationPlan,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors redis/mariadb/mongo).
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');
  const bucket = resolveBucketSegment(plan.path);
  ctx.setCommand(preview(plan).join(';\n'));

  let affectedRows = 0;
  for (const op of plan.ops) {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    if (op.kind === 'update') {
      await applyUpdate(client, ctx, bucket, op);
    } else if (op.kind === 'delete') {
      await applyDelete(client, ctx, bucket, op);
    } else {
      await applyInsert(client, ctx, bucket, op);
    }
    affectedRows += 1;
  }

  return { affectedRows };
}
