import { AdapterError } from '../errors';

// Mirrors sqs/errors.ts's mapSqsError exactly (same SDK v3 error shape: `name` is the AWS error
// code, `$metadata` on a service-side rejection) — including falling a missing bucket/object
// through to the default E_QUERY, the same way sqs/errors.ts falls a missing queue through.
export function mapS3Error(err: unknown): AdapterError {
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
  // E_QUERY, not E_NOT_FOUND: every DISCONNECTED_CODES set (views/keyvalue/state.ts and friends)
  // treats E_NOT_FOUND as "the connection itself is gone" and gates the tab behind a Reconnect
  // prompt with no error shown — reconnecting re-reads the same missing key and gates again,
  // silently and forever. sqs/errors.ts's own "a nonexistent queue is E_QUERY" precedent (see
  // sqs.spec.ts) is the same call for the same reason.
  const code = (err as { code?: string } | undefined)?.code;
  if (name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || name === 'NetworkingError') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
