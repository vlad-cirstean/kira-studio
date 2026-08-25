import { ReplyError } from 'ioredis';
import { AdapterError } from '../errors';

// Mirrors mysql-family/errors.ts's mapError / mongo/errors.ts's mapError — a single place
// that turns a driver-thrown error into the closed AdapterError code set, preserving the
// server's own message verbatim (Adapter rule 4).
export function mapError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'AbortError') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return new AdapterError('E_CONNECT', message, err);
  }
  if (err instanceof ReplyError) {
    if (/^(NOAUTH|WRONGPASS|NOPERM)\b/.test(message) || /invalid password/i.test(message)) {
      return new AdapterError('E_AUTH', message, err);
    }
    return new AdapterError('E_QUERY', message, err);
  }
  if (/connection is closed/i.test(message) || /stream isn't writeable/i.test(message)) {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
