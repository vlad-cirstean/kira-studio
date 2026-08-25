import type { ConnectionKind } from '../../shared/domain/connection';

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
