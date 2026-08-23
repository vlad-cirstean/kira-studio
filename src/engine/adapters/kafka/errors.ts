import { AdapterError } from '../errors';

// Mirrors redis/errors.ts's mapRedisError — a single place that turns a kafkajs-thrown error
// into the closed AdapterError code set, preserving the server's own message verbatim (Adapter
// rule 4). kafkajs throws plain Error subclasses tagged with a `name`, not a driver-specific
// error hierarchy, so classification goes by `name`/`message` pattern rather than `instanceof`.
export function mapKafkaError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (name === 'KafkaJSConnectionError' || name === 'KafkaJSConnectionClosedError') {
    return new AdapterError('E_CONNECT', message, err);
  }
  if (name === 'KafkaJSRequestTimeoutError') {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (name === 'KafkaJSSASLAuthenticationError') {
    return new AdapterError('E_AUTH', message, err);
  }
  // A generic terminal-retry wrapper — kafkajs throws this once ANY retriable operation
  // (metadata fetch, protocol call, connection) exhausts its retry budget, not just auth
  // failures (which are non-retriable and surface directly as KafkaJSSASLAuthenticationError
  // above, never wrapped here). Classify by what's actually wrapped in `.cause` instead of
  // assuming auth.
  if (name === 'KafkaJSNumberOfRetriesExceeded') {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && cause !== err) return mapKafkaError(cause);
    return new AdapterError('E_QUERY', message, err);
  }
  // A topic gone at read time (deleted concurrently) is an ordinary query-time condition, not a
  // connection failure — E_QUERY, deliberately not E_NOT_FOUND, which DISCONNECTED_CODES already
  // overloads to mean "the adapter/connection itself is gone" (mirrors P9's D10 for Redis).
  if (name.startsWith('KafkaJS')) {
    return new AdapterError('E_QUERY', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
