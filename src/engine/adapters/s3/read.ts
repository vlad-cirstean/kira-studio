import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  createKeyValuePageBuilder,
  type KeyValuePage,
  type PagePosition,
} from '../../../shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapS3Error } from './errors';

// A hard ceiling on how much of an object's body this will ever buffer into memory before giving
// up on previewing it — well above the page-builder's own 4MB display truncation (page.ts's
// DOCUMENT_TRUNCATE_BYTES_SINGLE, reused here via singleRow) so a moderately large text object
// (a multi-MB JSON export, a log file) still previews in full up to that display budget, without
// this adapter ever attempting to buffer, say, a multi-GB video object just to throw most of it
// away a moment later.
const MAX_BODY_DOWNLOAD_BYTES = 32 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// One GetObjectCommand call carries both the metadata (ContentType/ContentLength/LastModified/
// ETag/StorageClass/user Metadata) and the body — unlike redis's readString, which needs
// TYPE+PTTL+MEMORY as three separate round trips, S3's single response already has everything.
// Always exactly one row of "position" (rowCount=1, hasMore=false): an object's own field/value
// listing never grows past what's pushed here, so there is nothing to paginate (req.cursor is
// intentionally unused — reopening the same object always re-reads it from the start).
export async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
  ctx: OpCtx,
): Promise<KeyValuePage> {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  let res: GetObjectCommandOutput;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }

  const builder = createKeyValuePageBuilder({
    redisType: 'object',
    ttlMs: null,
    memoryBytes: null,
    singleRow: true,
  });
  if (res.ContentType) builder.push('ContentType', res.ContentType);
  if (res.ContentLength !== undefined) {
    builder.push('ContentLength', `${res.ContentLength} bytes (${formatBytes(res.ContentLength)})`);
  }
  if (res.LastModified) builder.push('LastModified', res.LastModified.toISOString());
  if (res.ETag) builder.push('ETag', res.ETag);
  if (res.StorageClass) builder.push('StorageClass', res.StorageClass);
  for (const [k, v] of Object.entries(res.Metadata ?? {})) builder.push(`Metadata.${k}`, v);

  if (res.ContentLength !== undefined && res.ContentLength > MAX_BODY_DOWNLOAD_BYTES) {
    builder.push(
      'Body',
      `(too large to preview — ${formatBytes(res.ContentLength)}, over the ${formatBytes(MAX_BODY_DOWNLOAD_BYTES)} preview limit)`,
    );
  } else if (res.Body) {
    let bytes: Uint8Array;
    try {
      bytes = await res.Body.transformToByteArray();
    } catch (err) {
      throw mapS3Error(err);
    }
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    // Lossy on purpose (fatal: false) — a binary object opened for preview degrades to U+FFFD
    // replacement characters rather than the whole read failing; the ContentType/size fields
    // above already tell the user what they're looking at.
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    builder.push('Body', text);
  }

  const position: PagePosition = {
    offset: 0,
    pageSize: 1,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

// A HeadObjectCommand (no body transfer) — cheap enough to answer the toolbar's Count button with
// an exact number of field rows (ContentType/ContentLength/LastModified/ETag/StorageClass/
// Metadata.* — always present except StorageClass, plus a Body row whenever the object isn't
// empty), without duplicating readObject()'s own field-selection logic by hand.
export async function countObject(
  client: S3Client,
  bucket: string,
  key: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  let res: {
    ContentLength?: number;
    StorageClass?: string;
    Metadata?: Record<string, string>;
  };
  try {
    res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }
  // ContentType/ContentLength/LastModified/ETag are effectively always present on a real object;
  // StorageClass and a non-empty Body are the only conditional rows readObject() may skip.
  let value = 4 + Object.keys(res.Metadata ?? {}).length;
  if (res.StorageClass) value++;
  if (res.ContentLength && res.ContentLength > 0) value++;
  return { value, exact: true };
}
