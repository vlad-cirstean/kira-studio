/**
 * The blob-frame body shape (G3 plan D4), lifted out of `socketChannel.ts` (C10 S1) so
 * `streamChannel.ts` can share one implementation instead of holding a second copy of the same
 * layout. Environment-agnostic on purpose — no `node:net`/`Buffer` — since the Wails stream side
 * runs in a browser context with no Node globals.
 *
 * Layout: `0x00 | uint32BE headerLen | headerJSON | blob…to the end of the frame`. A frame's first
 * byte is `0x00` for a blob frame, `{` for a plain JSON one — the two can never collide.
 * `parseBlobFrameBody` finds the single `{"$blob":true}` marker gitrpc's own payload embeds (this
 * file never learns what a graph chunk is) and replaces it with the blob bytes as a fresh
 * `ArrayBuffer`.
 */

export const BLOB_FRAME_DISCRIMINANT = 0x00;
const BLOB_HEADER_LEN_OFFSET = 1;
const BLOB_HEADER_START = 5; // 1 discriminant byte + 4-byte big-endian header length.

/** Thrown on a blob frame this file cannot make sense of: a header length pointing past the
 *  frame's end, a header that is not valid JSON, or a header with no `{"$blob":true}` marker (or
 *  more than one) for the frame's own single blob to fill — a hard error, never a silent
 *  truncation or a guessed substitution. */
export class MalformedBlobFrameError extends Error {
  constructor(reason: string) {
    super(`blobFrame: malformed blob frame: ${reason}`);
    this.name = 'MalformedBlobFrameError';
  }
}

function isBlobMarker(value: unknown): value is { readonly $blob: true } {
  return (
    value !== null && typeof value === 'object' && (value as { $blob?: unknown }).$blob === true
  );
}

/** Walks message the same shape `codec.ts`'s three traversals do, replacing the single
 *  `{"$blob":true}` marker with blob. Lives here rather than in `codec.ts` because it is a
 *  property of a blob-carrying channel's own framing, not of the buffer encodings `codec.ts` owns. */
function substituteBlob(value: unknown, blob: ArrayBuffer, seen: { count: number }): unknown {
  if (isBlobMarker(value)) {
    seen.count++;
    return blob;
  }
  if (Array.isArray(value)) return value.map((item) => substituteBlob(item, blob, seen));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteBlob(item, blob, seen)]),
    );
  }
  return value;
}

function substituteBlobRoot(message: unknown, blob: ArrayBuffer): unknown {
  const seen = { count: 0 };
  const result = substituteBlob(message, blob, seen);
  if (seen.count === 0) {
    throw new MalformedBlobFrameError('header JSON carries no "$blob" marker');
  }
  if (seen.count > 1) {
    throw new MalformedBlobFrameError('header JSON carries more than one "$blob" marker');
  }
  return result;
}

/**
 * Parses one whole blob-frame body (starting at the `0x00` discriminant byte, running to the end
 * of the frame) into the substituted message. Throws `MalformedBlobFrameError` for a structurally
 * bad frame, or the `JSON.parse` `SyntaxError` for invalid header JSON — callers decide how to
 * report each (`socketChannel.ts` destroys the socket either way).
 */
export function parseBlobFrameBody(body: Uint8Array): unknown {
  if (body.byteLength < BLOB_HEADER_START) {
    throw new MalformedBlobFrameError('frame is too short for a header length');
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const headerLen = view.getUint32(BLOB_HEADER_LEN_OFFSET, false);
  const headerEnd = BLOB_HEADER_START + headerLen;
  if (headerEnd > body.byteLength) {
    throw new MalformedBlobFrameError('declared header length exceeds the frame');
  }
  const headerBytes = body.subarray(BLOB_HEADER_START, headerEnd);
  const blobBytes = body.subarray(headerEnd);
  // A fresh, exactly-sized ArrayBuffer — never a view into the caller's own receive buffer, which
  // may be mutated or reused as soon as the caller's own callback returns.
  const blob = blobBytes.buffer.slice(
    blobBytes.byteOffset,
    blobBytes.byteOffset + blobBytes.byteLength,
  ) as ArrayBuffer;
  const message: unknown = JSON.parse(new TextDecoder('utf-8').decode(headerBytes));
  return substituteBlobRoot(message, blob);
}
