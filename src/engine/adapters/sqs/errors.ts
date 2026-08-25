import { AdapterError } from '../errors';

// Mirrors redis/errors.ts's mapError / kafka/errors.ts's mapError — a single place
// that turns an AWS SDK v3-thrown error into the closed AdapterError code set, preserving the
// server's own message verbatim (Adapter rule 4). SDK v3 errors carry a `name` set to the AWS
// error code (e.g. 'QueueDoesNotExist') and, for a service-side rejection, `$metadata`.
export function mapError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (
    name === 'CredentialsProviderError' ||
    name === 'UnrecognizedClientException' ||
    name === 'InvalidClientTokenId' ||
    name === 'AccessDenied' ||
    name === 'SignatureDoesNotMatch'
  ) {
    return new AdapterError('E_AUTH', message, err);
  }
  const code = (err as { code?: string } | undefined)?.code;
  if (name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || name === 'NetworkingError') {
    return new AdapterError('E_CONNECT', message, err);
  }
  // A queue gone at read time (deleted concurrently) is an ordinary query-time condition, not a
  // connection failure — E_QUERY, deliberately not E_NOT_FOUND (mirrors P9's D10, kafka's own
  // errors.ts).
  return new AdapterError('E_QUERY', message, err);
}
