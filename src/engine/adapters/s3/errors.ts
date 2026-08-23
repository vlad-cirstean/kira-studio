import { AdapterError } from '../errors';

// Mirrors sqs/errors.ts's mapSqsError exactly (same SDK v3 error shape: `name` is the AWS error
// code, `$metadata` on a service-side rejection) — the one addition is NoSuchBucket/NoSuchKey,
// which SQS has no equivalent of (a queue that's gone is a query-time condition there too, but
// there's no per-item "NoSuchMessage" the SDK itself would throw).
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
  // A bucket/object gone at read time (deleted concurrently, or a bad path typed by hand) is an
  // ordinary query-time condition, not a connection failure — E_NOT_FOUND, since unlike sqs/kafka
  // there's no ambiguity here: the SDK itself distinguishes "never existed"/"no longer exists"
  // from every other failure mode with these two exact names.
  if (name === 'NoSuchBucket' || name === 'NoSuchKey') {
    return new AdapterError('E_NOT_FOUND', message, err);
  }
  const code = (err as { code?: string } | undefined)?.code;
  if (name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || name === 'NetworkingError') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
