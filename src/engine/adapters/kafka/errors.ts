import { CODES } from '@confluentinc/kafka-javascript';
import { AdapterError } from '../errors';

// P32 D17: classification moves from kafkajs's error *names* to librdkafka's numeric error
// *codes* — the migration guide is explicit that names are no longer the classification surface,
// and two of today's three name branches (KafkaJSNumberOfRetriesExceeded,
// KafkaJSConnectionClosedError) were deleted from the library outright. Codes are a closed,
// documented, numerically stable set, which is a better contract than a string a library rename
// can break. The server's own message is preserved verbatim regardless (Adapter rule 4).
const { ERRORS } = CODES;

const CONNECT_CODES = new Set<number>([
  ERRORS.ERR__TRANSPORT,
  ERRORS.ERR__RESOLVE,
  ERRORS.ERR__ALL_BROKERS_DOWN,
  ERRORS.ERR__STATE,
]);

const TIMEOUT_CODES = new Set<number>([ERRORS.ERR__TIMED_OUT, ERRORS.ERR__TIMED_OUT_QUEUE]);

// Authentication failures move to E_AUTH (not E_QUERY) because the user's remedy is
// credentials/ACLs, not a different query — widened from kafkajs's single SASL-failure branch to
// also cover the three authorization-failed codes this client exposes.
const AUTH_CODES = new Set<number>([
  ERRORS.ERR__AUTHENTICATION,
  ERRORS.ERR_SASL_AUTHENTICATION_FAILED,
  ERRORS.ERR_TOPIC_AUTHORIZATION_FAILED,
  ERRORS.ERR_GROUP_AUTHORIZATION_FAILED,
  ERRORS.ERR_CLUSTER_AUTHORIZATION_FAILED,
]);

// A topic/partition gone at read time (deleted concurrently) is an ordinary query-time
// condition, not a connection failure — E_QUERY, deliberately not E_NOT_FOUND, which
// DISCONNECTED_CODES-equivalent handling already overloads to mean "the adapter/connection
// itself is gone" (mirrors P9's D10 for Redis, and the pre-P32 comment this preserves).
const UNKNOWN_TOPIC_CODES = new Set<number>([
  ERRORS.ERR__UNKNOWN_TOPIC,
  ERRORS.ERR_UNKNOWN_TOPIC_OR_PART,
]);

function codeOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'number') {
    return err.code;
  }
  return null;
}

export function mapKafkaError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  // AbortError still surfaces by name/message, not a librdkafka code — it's this app's own
  // AbortSignal machinery firing, not something the driver itself classifies.
  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new AdapterError('E_CANCELLED', message, err);
  }

  const code = codeOf(err);
  if (code !== null) {
    if (CONNECT_CODES.has(code)) return new AdapterError('E_CONNECT', message, err);
    if (TIMEOUT_CODES.has(code)) return new AdapterError('E_TIMEOUT', message, err);
    if (AUTH_CODES.has(code)) return new AdapterError('E_AUTH', message, err);
    if (UNKNOWN_TOPIC_CODES.has(code)) return new AdapterError('E_QUERY', message, err);
  }

  // Secondary fallback: a handful of compat-layer errors are still thrown as plain Error
  // subclasses tagged with a `name` (e.g. an argument-validation error raised before any
  // librdkafka call happens at all, so it never carries a `.code`).
  if (name === 'KafkaJSConnectionError') return new AdapterError('E_CONNECT', message, err);
  if (name === 'KafkaJSSASLAuthenticationError') return new AdapterError('E_AUTH', message, err);
  if (name === 'KafkaJSRequestTimeoutError') return new AdapterError('E_TIMEOUT', message, err);

  return new AdapterError('E_QUERY', message, err);
}
