import { AdapterError } from '../errors';

interface PgDriverError {
  code?: string;
  message?: string;
}

// Exported so client.ts can map a raw pg connection-time failure (client.connect() itself,
// before any query has run) the same way a query failure is mapped — an auth failure at
// connect time is just as much an E_AUTH as one hit mid-query.
export function mapError(err: unknown): AdapterError {
  const driverCode = (err as PgDriverError | undefined)?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (driverCode === '28P01' || driverCode === '28000') {
    return new AdapterError('E_AUTH', message, err);
  }
  if (driverCode === '57014') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (driverCode === 'ECONNREFUSED' || driverCode === 'ENOTFOUND' || driverCode === 'ETIMEDOUT') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
