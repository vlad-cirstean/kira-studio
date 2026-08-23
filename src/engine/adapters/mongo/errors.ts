import { MongoNetworkError, MongoServerError, MongoServerSelectionError } from 'mongodb';
import { AdapterError } from '../errors';

// Mirrors mariadb/query.ts's mapMariaError — a single place that turns a driver-thrown error
// into the closed AdapterError code set, preserving the server's own message verbatim (Adapter
// rule 4). An AbortSignal-driven cancellation (D7's primary layer) throws an 'AbortError' from
// the driver itself, not a MongoServerError — checked first.
export function mapMongoError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'AbortError') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (err instanceof MongoServerSelectionError || err instanceof MongoNetworkError) {
    return new AdapterError('E_CONNECT', message, err);
  }
  if (err instanceof MongoServerError) {
    // 18 = AuthenticationFailed, 13 = Unauthorized.
    if (err.code === 18 || err.code === 13) return new AdapterError('E_AUTH', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
