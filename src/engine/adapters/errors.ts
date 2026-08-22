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
