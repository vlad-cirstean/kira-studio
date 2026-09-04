package httpclient

import "errors"

// ErrorCode is httpclient's own closed error vocabulary — deliberately not adapters.ErrorCode
// (P2 D8): that set's own comment forbids additions without a matching renderer change, and
// reusing e.g. E_CONNECT for a refused TCP connection would make views/shared/viewOp.ts's
// DISCONNECTED_CODES classify an HTTP transport failure as "the database connection is gone" and
// pop a Reconnect gate over a tab that has no connection to reconnect. bridge/http.go maps these
// straight through to ipcerr.New(code, message) instead, joining the ipcerr family.
type ErrorCode string

const (
	// E_BAD_REQUEST — unparseable URL, non-http(s) scheme, missing host, unknown method: refused
	// before anything is sent.
	CodeBadRequest ErrorCode = "E_BAD_REQUEST"
	// E_CANCELLED — ctx.Err() == context.Canceled: the Stop button, or the window closing.
	CodeCancelled ErrorCode = "E_CANCELLED"
	// E_TIMEOUT — context.DeadlineExceeded.
	CodeTimeout ErrorCode = "E_TIMEOUT"
	// E_HTTP_TRANSPORT — everything else: DNS failure, refused connection, TLS handshake
	// failure, a truncated response.
	CodeHTTPTransport ErrorCode = "E_HTTP_TRANSPORT"
)

// Error is httpclient's own error type, mirroring adapters.Error's shape (Code/Message/Cause,
// errors.As classification) in the package that owns this domain.
type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

func newError(code ErrorCode, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

// CodeOf reports the ErrorCode of err via errors.As, for a caller to branch on without importing
// this package's concrete type everywhere.
func CodeOf(err error) (ErrorCode, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e.Code, true
	}
	return "", false
}
