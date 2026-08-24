import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { OBJECT_UPLOAD_MAX_BYTES } from '../../../shared/protocol/page';
import { AdapterError } from '../errors';
import { formatBytes } from './read';

// P33: the only file in this adapter that touches node:fs — Adapter rule 1 ("an adapter imports
// nothing from electron") allows a plain Node module free rein here, and F15 confirms the engine
// utilityProcess can do its own file I/O without routing bytes through main.

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
