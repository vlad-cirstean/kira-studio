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
  OBJECT_BODY_PREVIEW_BYTES,
  unpagedPosition,
} from '@shared/protocol/page';
import type { OpCtx } from '../adapter';
import { throwIfCancelled } from '../errors';
import { mapError } from './errors';

export function formatBytes(n: number): string {
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
  throwIfCancelled(ctx);
  ctx.setCommand(`GetObject s3://${bucket}/${key}`);

  let head: HeadObjectCommandOutput;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapError(err);
  }

  const builder = createKeyValuePageBuilder({
    redisType: 'object',
    ttlMs: null,
    // P33 D5: an object's ContentLength *is* "how many bytes this item is" — the same question
    // memoryBytes answers for a redis key. KeyValueView.vue's size badge and the edit-size gate
    // both read it from here.
    memoryBytes: head.ContentLength ?? null,
    singleRow: true,
  });

  // P33 D4: one number governs fetch, decode and render alike — above it nothing is transferred
  // and no Body row exists at all (not a notice-as-value: F4 found the old 32 MB tier's "(too
  // large to preview...)" string indistinguishable from real content on the wire). The renderer
  // gates its own over-limit strip on the row's absence plus a known memoryBytes, the same shared
  // constant, not a parsed string. Download exists for exactly this case now.
  if (head.ContentLength === undefined || head.ContentLength > OBJECT_BODY_PREVIEW_BYTES) {
    pushMetadataFields(builder, head);
  } else {
    let res: GetObjectCommandOutput;
    try {
      res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: ctx.signal,
      });
    } catch (err) {
      throw mapError(err);
    }
    pushMetadataFields(builder, res);
    if (res.Body) {
      let bytes: Uint8Array;
      try {
        bytes = await res.Body.transformToByteArray();
      } catch (err) {
        throw mapError(err);
      }
      throwIfCancelled(ctx);
      // Lossy on purpose (fatal: false) — a binary object opened for preview degrades to U+FFFD
      // replacement characters rather than the whole read failing; the ContentType/size fields
      // above already tell the user what they're looking at.
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      builder.push('Body', text);
    }
  }

  return builder.finish(unpagedPosition(1));
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
  throwIfCancelled(ctx);
  ctx.setCommand(`HeadObject s3://${bucket}/${key}`);
  let res: HeadObjectCommandOutput;
  try {
    res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapError(err);
  }
  // ContentType/ContentLength/LastModified/ETag are effectively always present on a real object;
  // StorageClass is the only field readObject() may skip. P33 D4: the Body row itself is pushed
  // only when readObject() would actually fetch and decode one — a known length at or under
  // OBJECT_BODY_PREVIEW_BYTES — including an empty (0-byte) object, which still has an (empty)
  // body stream. An over-limit or unknown-length object gets no Body row from either function, so
  // Count and the visible row count never disagree (F6).
  let value = 4 + Object.keys(res.Metadata ?? {}).length;
  if (res.StorageClass) value++;
  if (res.ContentLength !== undefined && res.ContentLength <= OBJECT_BODY_PREVIEW_BYTES) value++;
  return { value, exact: true };
}
