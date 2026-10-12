package ipcerr

// Code is a wire error code. The TS twin is packages/shared/domain/errorCodes.ts.
type Code string

// Generic codes.
const (
	CodeInternal     Code = "E_INTERNAL"
	CodeContract     Code = "E_CONTRACT"
	CodeBadRequest   Code = "E_BAD_REQUEST"
	CodeNotFound     Code = "E_NOT_FOUND"
	CodeConflict     Code = "E_CONFLICT"
	CodeUnavailable  Code = "E_UNAVAILABLE"
	CodeTimeout      Code = "E_TIMEOUT"
	CodeCancelled    Code = "E_CANCELLED"
	CodeTransport    Code = "E_TRANSPORT"
	CodeUnauthorized Code = "E_UNAUTHORIZED"
	CodeForbidden    Code = "E_FORBIDDEN"
	CodeReadOnly     Code = "E_READ_ONLY"
	CodeTooLarge     Code = "E_TOO_LARGE"
	CodeUnsupported  Code = "E_UNSUPPORTED"
	CodeRateLimited  Code = "E_RATE_LIMITED"
	CodeDisconnected Code = "E_DISCONNECTED"
	CodeSecretStore  Code = "E_SECRET_STORE"
)

// Domain codes: kept only where a UI branches on them.
const (
	CodeConnect             Code = "E_CONNECT"
	CodeAuth                Code = "E_AUTH"
	CodeQuery               Code = "E_QUERY"
	CodeEngineDown          Code = "E_ENGINE_DOWN"
	CodeGitNotARepository   Code = "E_GIT_NOT_A_REPOSITORY"
	CodeGitPermissionDenied Code = "E_GIT_PERMISSION_DENIED"
	CodeGitCancelled        Code = "E_GIT_CANCELLED"
	CodeGitTimeout          Code = "E_GIT_TIMEOUT"
	CodeGitUnknown          Code = "E_GIT_UNKNOWN"
	CodeGitUnavailable      Code = "E_GIT_UNAVAILABLE"
	CodePreparing           Code = "E_PREPARING"
	CodeRevoked             Code = "E_REVOKED"
	CodeExpired             Code = "E_EXPIRED"
	CodePairingDenied       Code = "E_PAIRING_DENIED"
	CodeWriteOff            Code = "E_WRITE_OFF"
	CodeAgentInputOff       Code = "E_AGENT_INPUT_OFF"
	CodeRecreateFailed      Code = "E_RECREATE_FAILED"
	CodeAlreadyImported     Code = "E_ALREADY_IMPORTED"
	CodeUnknownMethod       Code = "E_UNKNOWN_METHOD"
	CodeIdempotencyKey      Code = "E_IDEMPOTENCY_KEY"
	CodeIdempotencyMismatch Code = "E_IDEMPOTENCY_MISMATCH"
	CodeFrameTooLarge       Code = "E_FRAME_TOO_LARGE"
)

// Legacy lists retired codes still present in the tree. Streams empty it; close-out deletes it.
// Retired mapping: E_INVALID to E_BAD_REQUEST, E_CONFLICT or E_CONTRACT per site; E_STALE,
// E_TERMINAL_BUSY, E_IN_FLIGHT, E_WORKSPACE_CLOSED to E_CONFLICT; E_GRPC_CANCELLED to
// E_CANCELLED; E_GRPC_BAD_REQUEST and E_GRPC_SCHEMA to E_BAD_REQUEST; E_HTTP_TRANSPORT and
// E_GRPC_TRANSPORT to E_TRANSPORT; E_DOCKER_UNAVAILABLE and E_NO_WINDOW to E_UNAVAILABLE;
// E_LAUNCH_TIMEOUT to E_TIMEOUT.
var Legacy = map[Code]Code{
	"E_INVALID":            CodeBadRequest,
	"E_STALE":              CodeConflict,
	"E_TERMINAL_BUSY":      CodeConflict,
	"E_IN_FLIGHT":          CodeConflict,
	"E_WORKSPACE_CLOSED":   CodeConflict,
	"E_GRPC_CANCELLED":     CodeCancelled,
	"E_GRPC_BAD_REQUEST":   CodeBadRequest,
	"E_HTTP_TRANSPORT":     CodeTransport,
	"E_GRPC_TRANSPORT":     CodeTransport,
	"E_DOCKER_UNAVAILABLE": CodeUnavailable,
	"E_NO_WINDOW":          CodeUnavailable,
	"E_LAUNCH_TIMEOUT":     CodeTimeout,
	"E_GRPC_SCHEMA":        CodeBadRequest,
}
