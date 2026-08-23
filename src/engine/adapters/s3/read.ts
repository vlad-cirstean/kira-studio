import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
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

// The metadata fields HeadObject and GetObject both return identically — only GetObject also
// carries Body — pushed once here so the oversized/normal branches below can't drift apart.
function pushMetadataFields(
  builder: ReturnType<typeof createKeyValuePageBuilder>,
  meta: HeadObjectCommandOutput,
): void {
  if (meta.ContentType) builder.push('ContentType', meta.ContentType);
  if (meta.ContentLength !== undefined) {
    builder.push(
      'ContentLength',
      `${meta.ContentLength} bytes (${formatBytes(meta.ContentLength)})`,
    );
  }
  if (meta.LastModified) builder.push('LastModified', meta.LastModified.toISOString());
  if (meta.ETag) builder.push('ETag', meta.ETag);
  if (meta.StorageClass) builder.push('StorageClass', meta.StorageClass);
  for (const [k, v] of Object.entries(meta.Metadata ?? {})) builder.push(`Metadata.${k}`, v);
}

// HeadObject first, always — it answers "is this too large to preview" without ever opening a
// body stream, so the oversized branch below never has a GetObjectCommandOutput.Body left
// dangling unread. GetObject is only issued once we already know the object is small enough to
// fully buffer. Always exactly one row of "position" (rowCount=1, hasMore=false): an object's own
// field/value listing never grows past what's pushed here, so there is nothing to paginate
// (req.cursor is intentionally unused — reopening the same object always re-reads it from the
// start).
export async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
  ctx: OpCtx,
): Promise<KeyValuePage> {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  ctx.setCommand(`GetObject s3://${bucket}/${key}`);

  let head: HeadObjectCommandOutput;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
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

  if (head.ContentLength !== undefined && head.ContentLength > MAX_BODY_DOWNLOAD_BYTES) {
    pushMetadataFields(builder, head);
    builder.push(
      'Body',
      `(too large to preview — ${formatBytes(head.ContentLength)}, over the ${formatBytes(MAX_BODY_DOWNLOAD_BYTES)} preview limit)`,
    );
  } else {
    let res: GetObjectCommandOutput;
    try {
      res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: ctx.signal,
      });
    } catch (err) {
      throw mapS3Error(err);
    }
    pushMetadataFields(builder, res);
    if (res.Body) {
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
// Metadata.* — always present except StorageClass, plus a Body row whenever readObject() would
// push one), without duplicating readObject()'s own field-selection logic by hand.
export async function countObject(
  client: S3Client,
  bucket: string,
  key: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }> {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
  ctx.setCommand(`HeadObject s3://${bucket}/${key}`);
  let res: HeadObjectCommandOutput;
  try {
    res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapS3Error(err);
  }
  // ContentType/ContentLength/LastModified/ETag are effectively always present on a real object;
  // StorageClass is the only field readObject() may skip. The Body row itself is pushed for any
  // object with a known length — including an empty (0-byte) one, which still has an (empty)
  // body stream — so this counts on ContentLength being *defined*, not merely truthy.
  let value = 4 + Object.keys(res.Metadata ?? {}).length;
  if (res.StorageClass) value++;
  if (res.ContentLength !== undefined) value++;
  return { value, exact: true };
}
