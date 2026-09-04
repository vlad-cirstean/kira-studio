package gitclient

import (
	"context"
	"errors"
	"strings"
)

// ErrorKind is gitclient's own closed error vocabulary — exit code + stderr classified into a
// small set a caller can branch on, mirroring httpclient.ErrorCode's own reasoning (P1 D1
// follows bridge/http.go's precedent, and httpclient/errors.go is the direct model). P2 grows
// this set as real porcelain operations arrive (a merge conflict, a rejected push); P1 only ever
// produces the kinds its own two commands (`--version`, `rev-parse`) can actually hit.
type ErrorKind string

const (
	// KindNotARepository — rev-parse run outside any git repository ("not a git repository (or
	// any of the parent directories)").
	KindNotARepository ErrorKind = "notARepository"
	// KindPermissionDenied — the git binary or a path it touched refused access.
	KindPermissionDenied ErrorKind = "permissionDenied"
	// KindCancelled — ctx.Err() == context.Canceled: the caller gave up, not a failure.
	KindCancelled ErrorKind = "cancelled"
	// KindTimeout — context.DeadlineExceeded.
	KindTimeout ErrorKind = "timeout"
	// KindUnknown — every other nonzero exit or spawn failure; Message still carries stderr (or
	// the spawn error) verbatim for a log line, even when this package has no better label for it.
	KindUnknown ErrorKind = "unknown"
)

// Error is gitclient's own error type. Command/ExitCode/Stderr are the raw material Classify
// worked from, kept on the value for a caller that wants to log more than the classified Kind.
type Error struct {
	Kind     ErrorKind
	Command  []string
	ExitCode int
	Stderr   string
	Cause    error
}

func (e *Error) Error() string {
	if e.Stderr != "" {
		return strings.TrimSpace(e.Stderr)
	}
	if e.Cause != nil {
		return e.Cause.Error()
	}
	return string(e.Kind)
}

func (e *Error) Unwrap() error { return e.Cause }

// KindOf reports err's ErrorKind via errors.As, for a caller to branch on without importing this
// package's concrete type — mirrors httpclient.CodeOf.
func KindOf(err error) (ErrorKind, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind, true
	}
	return "", false
}

// notARepoNeedles are the stderr substrings every git subcommand this package spawns uses for
// "not inside a repository" — stable across the versions this app's 2.38 floor covers, and
// deliberately not full-sentence-matched (git's own wording has punctuation/parenthetical
// variance across platforms) the same way httpclient never full-string-matches an OS error.
var notARepoNeedles = []string{
	"not a git repository",
}

var permissionNeedles = []string{
	"permission denied",
	"operation not permitted",
}

// Classify turns a spawn outcome into gitclient's own Error. ctx is checked first (F20/D8's own
// point in httpclient/client.go: a caller cancelling mid-run must classify as KindCancelled, not
// whatever exit code the killed process happened to leave behind).
func Classify(ctx context.Context, command []string, res Result, runErr error) error {
	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return &Error{Kind: KindTimeout, Command: command, Cause: runErr}
		}
		return &Error{Kind: KindCancelled, Command: command, Cause: runErr}
	}
	if runErr != nil {
		return &Error{Kind: KindUnknown, Command: command, Cause: runErr}
	}
	if res.ExitCode == 0 {
		return nil
	}
	stderr := string(res.Stderr)
	lower := strings.ToLower(stderr)
	kind := KindUnknown
	for _, needle := range notARepoNeedles {
		if strings.Contains(lower, needle) {
			kind = KindNotARepository
			break
		}
	}
	if kind == KindUnknown {
		for _, needle := range permissionNeedles {
			if strings.Contains(lower, needle) {
				kind = KindPermissionDenied
				break
			}
		}
	}
	return &Error{Kind: kind, Command: command, ExitCode: res.ExitCode, Stderr: strings.TrimSpace(stderr)}
}
