export type AdapterErrorCode =
  | 'E_CONNECT'
  | 'E_AUTH'
  | 'E_CANCELLED'
  | 'E_TIMEOUT'
  | 'E_NOT_FOUND'
  | 'E_DISCONNECTED'
  | 'E_QUERY'
  | 'E_UNSUPPORTED'
  | 'E_ENGINE_DOWN';

export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// Preserves the server's message verbatim (§8.5 / §8.14 require unmodified server errors); the code
// is the only structured addition.
export function toWireError(err: unknown): { message: string; code?: string } {
  if (err instanceof AdapterError) return { message: err.message, code: err.code };
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}
