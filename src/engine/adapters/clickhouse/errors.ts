import { AdapterError } from '../errors';

interface ClickHouseDriverError {
  code?: string;
  type?: string;
}

// P36 F6 — ClickHouse's own numeric result codes (src/Common/ErrorCodes.cpp@master). An extended
// code beyond this short list falls through to E_QUERY with the server's own message verbatim
// (Adapter rule 4) — its own text ("Table default.t does not exist") is already better than
// anything a wrapper would compose.
const UNKNOWN_IDENTIFIER = '47';
const NOT_IMPLEMENTED = '48';
const UNKNOWN_TABLE = '60';
const UNKNOWN_DATABASE = '81';
const TIMEOUT_EXCEEDED = '159';
const READONLY = '164';
const UNKNOWN_USER = '192';
const WRONG_PASSWORD = '193';
const REQUIRED_PASSWORD = '194';
const IP_ADDRESS_NOT_ALLOWED = '195';
const SOCKET_TIMEOUT = '209';
const NETWORK_ERROR = '210';
const TABLE_IS_READ_ONLY = '242';
const DATABASE_ACCESS_DENIED = '291';
const QUERY_WAS_CANCELLED = '394';
const ACCESS_DENIED = '497';
const AUTHENTICATION_FAILED = '516';

// P36 D26 (this file's own decision, mirroring P35 D26's "classify, never sniff the message"
// discipline): dispatched on the numeric `code` ClickHouseError parses out of the server's own
// `Code: N. DB::Exception: ...` envelope (F5) — never on message text.
export function mapError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const e = err as ClickHouseDriverError | undefined;
  const code = e?.code;

  if (code === UNKNOWN_TABLE || code === UNKNOWN_DATABASE || code === UNKNOWN_IDENTIFIER) {
    return new AdapterError('E_NOT_FOUND', message, err);
  }
  if (code === TIMEOUT_EXCEEDED || code === SOCKET_TIMEOUT) {
    return new AdapterError('E_TIMEOUT', message, err);
  }
  if (code === READONLY || code === TABLE_IS_READ_ONLY) {
    return new AdapterError('E_UNSUPPORTED', message, err);
  }
  if (
    code === UNKNOWN_USER ||
    code === WRONG_PASSWORD ||
    code === REQUIRED_PASSWORD ||
    code === AUTHENTICATION_FAILED ||
    code === IP_ADDRESS_NOT_ALLOWED ||
    code === DATABASE_ACCESS_DENIED ||
    code === ACCESS_DENIED
  ) {
    return new AdapterError('E_AUTH', message, err);
  }
  if (code === QUERY_WAS_CANCELLED) {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (code === NOT_IMPLEMENTED) {
    return new AdapterError('E_QUERY', message, err);
  }
  if (code === NETWORK_ERROR) {
    return new AdapterError('E_CONNECT', message, err);
  }

  // Not a ClickHouseError at all — a plain Node/HTTP-level failure (F8: the driver throws a bare
  // Error on connection refusal, DNS failure, or an aborted request, none of which carry `code`).
  const nodeCode = (err as { code?: string } | undefined)?.code;
  if (nodeCode === 'ECONNREFUSED' || nodeCode === 'ENOTFOUND' || nodeCode === 'EHOSTUNREACH') {
    return new AdapterError('E_CONNECT', message, err);
  }
  if (nodeCode === 'ETIMEDOUT' || nodeCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return new AdapterError('E_TIMEOUT', message, err);
  }

  return new AdapterError('E_QUERY', message, err);
}
