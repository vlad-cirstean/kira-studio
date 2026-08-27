import { AdapterError } from '../errors';

// Mirrors sqs/errors.ts's mapError exactly (same SDK v3 error shape: `name` is the AWS error
// code, `$metadata` on a service-side rejection) — including falling a missing bucket/object
// through to the default E_QUERY, the same way sqs/errors.ts falls a missing queue through.
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
    name === 'InvalidAccessKeyId' ||
    name === 'AccessDenied' ||
    name === 'SignatureDoesNotMatch'
  ) {
    return new AdapterError('E_AUTH', message, err);
  }
  // A bucket/object gone at read time (deleted concurrently, or a bad path typed by hand) is
  // E_QUERY, not E_NOT_FOUND — a plain data-level condition against a connection that is still
  // perfectly live, same as sqs/errors.ts's own "a nonexistent queue is E_QUERY" precedent (see
  // sqs.spec.ts).
  const code = (err as { code?: string } | undefined)?.code;
  if (name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || name === 'NetworkingError') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
