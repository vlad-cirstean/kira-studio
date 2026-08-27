import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, stat, unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectTransferResult } from '@shared/domain/object-store';
import { OBJECT_UPLOAD_MAX_BYTES } from '@shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError, throwIfCancelled } from '../errors';
import { mapError } from './errors';
import { formatBytes } from './read';

// P33: the only file in this adapter that touches node:fs — Adapter rule 1 ("an adapter imports
// nothing from electron") allows a plain Node module free rein here, and F15 confirms the engine
// utilityProcess can do its own file I/O without routing bytes through main.

// D10: writes to a sibling temp file and renames on success, unlinking on any failure or
// cancellation — streaming straight to destPath would leave a truncated file wearing the name of
// a complete one if the transfer is cancelled or fails partway through, with no way for the user
// to tell. Same directory as destPath, so the rename is atomic on one filesystem.
export async function downloadObject(
  client: S3Client,
  bucket: string,
  key: string,
  destPath: string,
  ctx: OpCtx,
): Promise<ObjectTransferResult> {
  throwIfCancelled(ctx);
  ctx.setCommand(`GetObject s3://${bucket}/${key} -> ${destPath}`);

  // HeadObject first — a real "no such object" error before any local file is even created,
  // mirroring read.ts's own HeadObject-before-GetObject discipline.
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapError(err);
  }

  const tmpPath = `${destPath}.kira-partial-${randomUUID()}`;
  let res: GetObjectCommandOutput;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: ctx.signal,
    });
  } catch (err) {
    throw mapError(err);
  }
  if (!res.Body) throw new AdapterError('E_QUERY', `${key} has no body to download`);

  try {
    await pipeline(res.Body as Readable, createWriteStream(tmpPath), { signal: ctx.signal });
    const written = await stat(tmpPath);
    await rename(tmpPath, destPath);
    return { bytes: written.size };
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw mapError(err);
  }
}

// stat()s the file before any network call, so a missing/unreadable source or an over-limit file
// fails before PutObject ever starts. AWS's own single-PutObject ceiling (D12) — above it an
// upload needs multipart, which this phase does not implement; the message names the limit rather
// than failing silently or truncating.
export async function openUploadBody(
  sourcePath: string,
): Promise<{ stream: Readable; size: number }> {
  let size: number;
  try {
    const info = await stat(sourcePath);
    size = info.size;
  } catch (err) {
    throw new AdapterError(
      'E_QUERY',
      `could not read local file ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (size > OBJECT_UPLOAD_MAX_BYTES) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `file is ${formatBytes(size)}, over the ${formatBytes(OBJECT_UPLOAD_MAX_BYTES)} single-upload limit — multipart upload is not supported`,
    );
  }
  return { stream: createReadStream(sourcePath), size };
}
