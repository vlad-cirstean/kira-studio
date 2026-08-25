import { AdapterError } from '../errors';

interface MariaDriverError {
  code?: string;
  errno?: number;
}

// P34 D4/F4/F5: with a cold server-side SHA2 cache, a plaintext MySQL 8 connection cannot complete
// caching_sha2_password without either TLS or the server's RSA public key — the driver throws
// ER_CANNOT_RETRIEVE_RSA_KEY (errno 45044) rather than a real auth failure, and a `verify-full`
// connection against a self-signed cert throws ER_SELF_SIGNED_SHA256 (45063). Both are, in effect,
// "this credential cannot be verified over this connection" — E_AUTH, not E_QUERY — with a message
// naming both documented remedies rather than the driver's own prose about `cachingRsaPublicKey`,
// which means nothing to a user who typed the right password. Harmless for MariaDB, which has no
// auth plugin that can raise either code.
const RSA_KEY_MESSAGE =
  "MySQL requires an encrypted connection or the server's public key for this account: add " +
  "sslmode=require, or set allowPublicKeyRetrieval=true to accept the server's key over an " +
  'unencrypted connection.';

// Exported so client.ts can map a connect-time failure the same way a query failure is mapped.
export function mapError(err: unknown): AdapterError {
  const e = err as MariaDriverError | undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (e?.errno === 1045 || e?.code === 'ER_ACCESS_DENIED_ERROR') {
    return new AdapterError('E_AUTH', message, err);
  }
  if (e?.errno === 45044 || e?.code === 'ER_CANNOT_RETRIEVE_RSA_KEY') {
    return new AdapterError('E_AUTH', RSA_KEY_MESSAGE, err);
  }
  if (e?.errno === 45063 || e?.code === 'ER_SELF_SIGNED_SHA256') {
    return new AdapterError('E_AUTH', RSA_KEY_MESSAGE, err);
  }
  if (e?.errno === 1317 || e?.code === 'ER_QUERY_INTERRUPTED') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (
    e?.code === 'ECONNREFUSED' ||
    e?.code === 'ENOTFOUND' ||
    e?.code === 'ETIMEDOUT' ||
    e?.code === 'ER_GET_CONNECTION_TIMEOUT'
  ) {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
