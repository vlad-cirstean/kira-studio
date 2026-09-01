package adapters

import (
	"context"
	"errors"
	"regexp"
)

// ErrorCode is the Go analogue of errors.ts's AdapterErrorCode — a closed set, verbatim from
// errors.ts:4-12 (P58a A5). Nothing is ever added here without a matching renderer change:
// src/renderer/views/shared/viewOp.ts and state/tabs.ts both branch on these exact strings, and a
// renamed or added code silently stops matching there.
type ErrorCode string

const (
	CodeConnect     ErrorCode = "E_CONNECT"
	CodeAuth        ErrorCode = "E_AUTH"
	CodeCancelled   ErrorCode = "E_CANCELLED"
	CodeTimeout     ErrorCode = "E_TIMEOUT"
	CodeNotFound    ErrorCode = "E_NOT_FOUND"
	CodeQuery       ErrorCode = "E_QUERY"
	CodeUnsupported ErrorCode = "E_UNSUPPORTED"
	CodeEngineDown  ErrorCode = "E_ENGINE_DOWN"
)

// Error is the Go analogue of errors.ts's AdapterError (named Error, not AdapterError, per A1 —
// adapters.AdapterError would stutter at every call site). Message is the server's own message
// verbatim (Adapter rule 4); wrapping starts and ends here.
type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

// New constructs an *Error. cause may be nil.
func New(code ErrorCode, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

// CodeOf reports the ErrorCode of err via errors.As, for the dispatcher and the router to branch
// on without importing this package's concrete type everywhere.
func CodeOf(err error) (ErrorCode, bool) {
	var ae *Error
	if errors.As(err, &ae) {
		return ae.Code, true
	}
	return "", false
}

// The seven helpers below port errors.ts's own, messages byte-identical (A6).

// Unsupported is errors.ts's unsupported(kind, what) — P39 F18's shared capability-stub message.
func Unsupported(kind, what string) error {
	return New(CodeUnsupported, what+" is not supported for "+kind, nil)
}

// NoQueryConsole is errors.ts's noQueryConsole(kind).
func NoQueryConsole(kind string) error {
	return New(CodeUnsupported, kind+" has no query console", nil)
}

// AssertWritable is errors.ts's assertWritable(readOnly) — P39 iter2 F15's shared read-only guard.
func AssertWritable(readOnly bool) error {
	if readOnly {
		return New(CodeUnsupported, "connection is read-only", nil)
	}
	return nil
}

var (
	sqlLineComment  = regexp.MustCompile(`--[^\n]*`)
	sqlBlockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
	sqlReadWrite    = regexp.MustCompile(`(?i)READ\s+WRITE`)
)

// AssertNoTransactionEscalation is a console-Execute-only backstop for postgres/mysqlfamily (P2
// R2): both enforce a read-only connection by setting a *session default*
// (default_transaction_read_only / SESSION TRANSACTION READ ONLY) at connect time and wrapping
// each Execute() batch in an explicit read-only transaction, neither of which a statement inside
// that same transaction can be trusted not to try to escape — verified against real servers that
// a bare `SET TRANSACTION READ WRITE` (postgres) mid-transaction actually does flip an
// already-open read-only transaction to writable, where every other angle tried (SET
// default_transaction_read_only=off, SET SESSION TRANSACTION READ WRITE, COMMIT;BEGIN;) does not
// escape the wrapping transaction on either server. "READ WRITE" has no legitimate reason to
// appear in a read-only console session, so any statement containing it (after stripping SQL
// comments, since a comment can sit between the two words) is rejected outright rather than run.
// Comments are replaced with a single space, not deleted outright: confirmed against a real
// server that `READ/*x*/WRITE` parses identically to `READ WRITE` (a comment is lexical
// whitespace to the SQL parser), so deleting it outright would collapse the two keywords together
// and slip past the \s+ in sqlReadWrite below.
func AssertNoTransactionEscalation(statements []string) error {
	for _, stmt := range statements {
		stripped := sqlBlockComment.ReplaceAllString(sqlLineComment.ReplaceAllString(stmt, " "), " ")
		if sqlReadWrite.MatchString(stripped) {
			return New(CodeUnsupported, "connection is read-only", nil)
		}
	}
	return nil
}

// CheckNotStarted is errors.ts's assertNotCancelled(ctx) — Adapter rule 2's pre-flight check,
// reporting a cancel that landed before the call started. Distinct message from CheckCancelled
// (A6): the two report genuinely different moments.
func CheckNotStarted(ctx context.Context) error {
	if ctx.Err() != nil {
		return New(CodeCancelled, "operation was cancelled before it started", ctx.Err())
	}
	return nil
}

// CheckCancelled is errors.ts's throwIfCancelled(ctx) — the mid-flight sibling, re-run after an
// await, not before starting.
func CheckCancelled(ctx context.Context) error {
	if ctx.Err() != nil {
		return New(CodeCancelled, "operation was cancelled", ctx.Err())
	}
	return nil
}

// RequireConnected is errors.ts's requireConnected(handle) — the "did connect() ever run" guard.
// Go has no null-vs-nil-pointer distinction to worry about here: a nil handle is the same "not
// connected" state a nullish TS handle represents.
func RequireConnected[T any](handle *T) (*T, error) {
	if handle == nil {
		return nil, New(CodeConnect, "adapter is not connected", nil)
	}
	return handle, nil
}
