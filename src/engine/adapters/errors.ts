import type { ConnectionKind } from '@shared/domain/connection';
import type { OpCtx } from './adapter';

export type AdapterErrorCode =
  | 'E_CONNECT'
  | 'E_AUTH'
  | 'E_CANCELLED'
  | 'E_TIMEOUT'
  | 'E_NOT_FOUND'
  | 'E_QUERY'
  | 'E_UNSUPPORTED'
  | 'E_ENGINE_DOWN';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly cause?: unknown;

  constructor(code: AdapterErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.cause = cause;
  }
}

// Preserves the server's message verbatim (Adapter rule 4) — §8.5/§8.14 both require unmodified
// server errors, so wrapping starts and ends here.
export function toWireError(err: unknown): { message: string; code?: string } {
  if (err instanceof AdapterError) return { message: err.message, code: err.code };
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

// P39 F18: the same E_UNSUPPORTED capability stub, sixteen times across nine adapters —
// describe()/definition() (an adapter with no metadata to describe/define), downloadObject() (an
// adapter with nothing S3-shaped to transfer). `what` reproduces each adapter's own wording
// (`'describe'`, `'definition'`, `'file transfer'`) so every message stays byte-identical.
export function unsupported(kind: ConnectionKind, what: string): never {
  throw new AdapterError('E_UNSUPPORTED', `${what} is not supported for ${kind}`);
}

// The remaining four capability stubs (execute() on an adapter with no query console) read
// kind-first rather than trailing it — a genuinely different sentence, not a fourth `what` value
// for unsupported() above.
export function noQueryConsole(kind: ConnectionKind): never {
  throw new AdapterError('E_UNSUPPORTED', `${kind} has no query console`);
}

// P39 iter2 F15: the read-only refusal every write-capable adapter's mutate.ts (and kafka's
// produce.ts) opens with, byte-identical ten times — adapter.ts's own contract sentence
// ("Throws E_UNSUPPORTED if the connection is read-only") implemented once instead of ten times.
export function assertWritable(readOnly: boolean): void {
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');
}

// P39 iter3 F17/D15: Adapter rule 2's pre-flight check ("Every method that talks to the server
// takes an OpCtx and honours ctx.signal") — written out nine times across five adapters, two of
// them under the name checkNotCancelled. Message preserved byte-for-byte.
export function assertNotCancelled(ctx: OpCtx): void {
  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }
}

// P48 F21: assertNotCancelled's mid-flight sibling — the check adapters re-run after an await,
// not before starting. Twenty-six identical copies across eight adapters. The message differs from
// assertNotCancelled's on purpose: that one reports a cancel that landed before the call started.
export function throwIfCancelled(ctx: OpCtx): void {
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
}

// P48 F24: the "did connect() ever run" guard ten adapters open their private handle accessors
// with, byte-identical every time.
export function requireConnected<T>(handle: T | null | undefined): T {
  if (!handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
  return handle;
}
