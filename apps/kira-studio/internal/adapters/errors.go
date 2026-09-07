package adapters

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

// ErrorCode is the Go analogue of errors.ts's AdapterErrorCode — a closed set, verbatim from
// errors.ts:4-12 (P58a A5). Nothing is ever added here without a matching renderer change:
// apps/kira-studio/frontend/src/views/shared/viewOp.ts and state/tabs.ts both branch on these exact strings, and a
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
	sqlReadWrite = regexp.MustCompile(`(?i)READ\s+WRITE`)
	// sqlReadOnlyVarOff catches a statement that names any of the three read-only-mode GUCs/session
	// variables the postgres and mysqlfamily adapters rely on (default_transaction_read_only /
	// transaction_read_only on postgres and mysql, tx_read_only on mariadb) and assigns it a falsy
	// value — the non-SQL-standard way to ask for the same escalation "READ WRITE" asks for by
	// phrase (review finding: `SET transaction_read_only = off` inside the wrapping transaction
	// confirmed, against a real Postgres server, to flip that transaction writable and let a
	// following DELETE succeed, with no "READ WRITE" phrase anywhere in the statement for
	// sqlReadWrite to catch).
	sqlReadOnlyVarOff = regexp.MustCompile(`(?i)\b(?:default_transaction_read_only|transaction_read_only|tx_read_only)\b\s*(?:=|TO)\s*'?(?:off|false|0)\b`)
)

// endsTransaction reports whether stmt (already comment-stripped) is a bare statement that ends
// the current transaction — COMMIT, END (postgres's alias for COMMIT), or ROLLBACK — rather than
// a statement that merely mentions one of those words. A real read-only console session has no
// legitimate reason to end its own wrapping transaction mid-batch (postgres/mysqlfamily console.go
// both wrap the whole Execute() batch in one read-only transaction specifically so no statement in
// it can run outside that transaction's protection): confirmed against a real server that
// `COMMIT; SET SESSION tx_read_only = OFF; ...` (mariadb) / `SET SESSION transaction_read_only =
// OFF` (mysql) does exactly that — the COMMIT ends the wrapper, and the SET then takes effect
// immediately for the write statement that follows in plain autocommit mode, with neither the
// COMMIT nor the SET containing "READ WRITE" for sqlReadWrite to catch (postgres itself is not
// vulnerable to this particular sequence — confirmed empirically that transaction_read_only set
// outside an explicit transaction does not carry over to the next implicit one there — but nothing
// about a read-only console session ever legitimately needs its own COMMIT/END/ROLLBACK either, so
// this is rejected unconditionally rather than only where a bypass happens to have been proven).
// ROLLBACK TO SAVEPOINT is exempted: it only rewinds to a savepoint, never ends the transaction.
func endsTransaction(stmt string) bool {
	trimmed := strings.TrimSuffix(strings.TrimSpace(stmt), ";")
	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "COMMIT", "END":
		return true
	case "ROLLBACK":
		for _, f := range fields[1:] {
			if strings.EqualFold(f, "TO") {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// stripSQLComments replaces every SQL comment — a line comment (`--` to end of line) or a block
// comment (`/* ... */`) — with a single space, preserving token boundaries the same way real SQL
// treats a comment as lexical whitespace (confirmed against a real server: `READ/*x*/WRITE` parses
// identically to `READ WRITE`, so a comment must become a space, never be deleted outright, or the
// two keywords it separated would glue together and slip past sqlReadWrite's \s+). Block comments
// nest on both postgres and mysql/mariadb — confirmed against a real Postgres server that `READ
// /* /* */ x */ WRITE` parses identically to `READ WRITE`, i.e. the outer /* runs all the way to
// its own matching, correctly-nested */, swallowing the inner comment and the "x" between them —
// which a single non-nesting regexp pass cannot express, so this scans by rune and tracks depth
// instead.
func stripSQLComments(s string) string {
	r := []rune(s)
	var out strings.Builder
	depth := 0
	for i := 0; i < len(r); {
		switch {
		case depth == 0 && r[i] == '-' && i+1 < len(r) && r[i+1] == '-':
			for i < len(r) && r[i] != '\n' {
				i++
			}
			out.WriteByte(' ')
		case r[i] == '/' && i+1 < len(r) && r[i+1] == '*':
			depth++
			i += 2
		case depth > 0 && r[i] == '*' && i+1 < len(r) && r[i+1] == '/':
			depth--
			i += 2
			if depth == 0 {
				out.WriteByte(' ')
			}
		case depth > 0:
			i++
		default:
			out.WriteRune(r[i])
			i++
		}
	}
	return out.String()
}

// AssertNoTransactionEscalation is a console-Execute-only backstop for postgres/mysqlfamily (P2
// R2, hardened per a later review round): both enforce a read-only connection by setting a
// *session default* (default_transaction_read_only / SESSION TRANSACTION READ ONLY) at connect
// time and wrapping each Execute() batch in an explicit read-only transaction, neither of which a
// statement inside that same transaction can be trusted not to try to escape. Three angles are
// rejected outright rather than run, each confirmed against a real server (see stripSQLComments,
// sqlReadOnlyVarOff and endsTransaction's own doc comments for what was actually tried and what a
// real server actually did): the SQL-standard `READ WRITE` phrase, naming a read-only GUC/session
// variable and assigning it a falsy value, and a bare COMMIT/END/ROLLBACK that would end the
// wrapping transaction itself. This function cannot be made complete against every possible
// escalation a SQL dialect can express — it is a backstop on top of the real enforcement (the
// session default plus the wrapping transaction), not a substitute for it.
func AssertNoTransactionEscalation(statements []string) error {
	for _, stmt := range statements {
		stripped := stripSQLComments(stmt)
		if sqlReadWrite.MatchString(stripped) || sqlReadOnlyVarOff.MatchString(stripped) || endsTransaction(stripped) {
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
