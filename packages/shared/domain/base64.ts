// P107 T1-18: the trusted-input core both binary.ts (validates first, wraps in try/catch, returns
// null on bad input) and createTerminalsStore.ts (wire format is always valid, lets atob throw)
// used to define separately — same atob-then-charCodeAt-per-byte body either way.

/** Decodes standard base64 to raw bytes. Throws (like `atob`) on invalid input — callers that need
 *  a non-throwing, validating decode wrap this rather than duplicating the byte conversion. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
