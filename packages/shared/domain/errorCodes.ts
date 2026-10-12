// Wire error codes. Go twin: internal/ipcerr/codes.go.

export const ERROR_CODES = [
  'E_INTERNAL',
  'E_CONTRACT',
  'E_BAD_REQUEST',
  'E_NOT_FOUND',
  'E_CONFLICT',
  'E_UNAVAILABLE',
  'E_TIMEOUT',
  'E_CANCELLED',
  'E_TRANSPORT',
  'E_UNAUTHORIZED',
  'E_FORBIDDEN',
  'E_READ_ONLY',
  'E_TOO_LARGE',
  'E_UNSUPPORTED',
  'E_RATE_LIMITED',
  'E_DISCONNECTED',
  'E_SECRET_STORE',
  'E_CONNECT',
  'E_AUTH',
  'E_QUERY',
  'E_ENGINE_DOWN',
  'E_GIT_NOT_A_REPOSITORY',
  'E_GIT_PERMISSION_DENIED',
  'E_GIT_CANCELLED',
  'E_GIT_TIMEOUT',
  'E_GIT_UNKNOWN',
  'E_GIT_UNAVAILABLE',
  'E_PREPARING',
  'E_REVOKED',
  'E_EXPIRED',
  'E_PAIRING_DENIED',
  'E_WRITE_OFF',
  'E_AGENT_INPUT_OFF',
  'E_RECREATE_FAILED',
  'E_ALREADY_IMPORTED',
  'E_UNKNOWN_METHOD',
  'E_IDEMPOTENCY_KEY',
  'E_IDEMPOTENCY_MISMATCH',
  'E_FRAME_TOO_LARGE',
] as const;

/** Raised in TS only, never sent by Go. */
export const CLIENT_ERROR_CODES = ['E_NETWORK', 'E_FIXTURE_MISS'] as const;

/** Retired codes still present in the tree; mirrors `Legacy` in codes.go. */
export const LEGACY_ERROR_CODES = [
  'E_INVALID',
  'E_STALE',
  'E_TERMINAL_BUSY',
  'E_IN_FLIGHT',
  'E_WORKSPACE_CLOSED',
  'E_GRPC_CANCELLED',
  'E_GRPC_BAD_REQUEST',
  'E_HTTP_TRANSPORT',
  'E_GRPC_TRANSPORT',
  'E_DOCKER_UNAVAILABLE',
  'E_NO_WINDOW',
  'E_LAUNCH_TIMEOUT',
  'E_GRPC_SCHEMA',
] as const;

export type ErrorCode =
  | (typeof ERROR_CODES)[number]
  | (typeof CLIENT_ERROR_CODES)[number]
  | (typeof LEGACY_ERROR_CODES)[number];

const NOT_RETRYABLE: ReadonlySet<string> = new Set([
  'E_NOT_FOUND',
  'E_CONTRACT',
  'E_BAD_REQUEST',
  'E_FORBIDDEN',
  'E_UNAUTHORIZED',
  'E_UNSUPPORTED',
  'E_READ_ONLY',
  'E_TOO_LARGE',
  'E_CONFLICT',
]);

/** Whether a failed load offers Retry. A code outside the registry is retryable. */
export function isRetryable(code: string | undefined): boolean {
  return code === undefined || !NOT_RETRYABLE.has(code);
}
