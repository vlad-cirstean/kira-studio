package ghclient

import (
	"context"
	"errors"
	"testing"
)

// TestClassify_D5Table asserts every row of D5's mapping table from a recorded body + stderr + exit
// code, exactly as the plan's own exit criterion 3 asks.
func TestClassify_D5Table(t *testing.T) {
	cases := []struct {
		name       string
		res        Result
		runErr     error
		ctxErr     error
		wantKind   string
		wantReason string // substring, "" to skip the check
	}{
		{
			name:     "exit 0 decodes -> ok",
			res:      Result{ExitCode: 0, Stdout: []byte(`[]`)},
			wantKind: KindOK,
		},
		{
			name:     "spawn fails",
			runErr:   errors.New("permission denied"),
			wantKind: KindNotFound, wantReason: "could not be started",
		},
		{
			name:     "timeout",
			runErr:   context.DeadlineExceeded,
			wantKind: KindNotFound, wantReason: "did not respond",
		},
		{
			name:     "cancelled",
			ctxErr:   context.Canceled,
			wantKind: KindNotFound,
		},
		{
			name:     "HTTP 401",
			res:      Result{ExitCode: 1, Stderr: []byte("gh: Bad credentials (HTTP 401)")},
			wantKind: KindUnauthenticated, wantReason: "gh auth login",
		},
		{
			name: "HTTP 403 rate limit",
			res: Result{ExitCode: 1, Stderr: []byte(
				"gh: API rate limit exceeded for user ID 1. (HTTP 403)")},
			wantKind: KindForbidden, wantReason: "rate limit",
		},
		{
			name: "HTTP 403 SAML/SSO",
			res: Result{ExitCode: 1, Stderr: []byte(
				"gh: Resource protected by organization SAML enforcement. (HTTP 403)")},
			wantKind: KindForbidden, wantReason: "SSO",
		},
		{
			name:     "HTTP 403 other scope",
			res:      Result{ExitCode: 1, Stdout: []byte(`{"message":"Must have admin rights."}`), Stderr: []byte("gh: Must have admin rights. (HTTP 403)")},
			wantKind: KindForbidden, wantReason: "admin rights",
		},
		{
			name:     "HTTP 429",
			res:      Result{ExitCode: 1, Stderr: []byte("gh: (HTTP 429)")},
			wantKind: KindForbidden, wantReason: "rate limit",
		},
		{
			name:     "HTTP 404",
			res:      Result{ExitCode: 1, Stderr: []byte("gh: Not Found (HTTP 404)")},
			wantKind: KindForbidden, wantReason: "not found",
		},
		{
			name:     "HTTP 5xx",
			res:      Result{ExitCode: 1, Stderr: []byte("gh: Internal Server Error (HTTP 502)")},
			wantKind: KindForbidden, wantReason: "did not answer",
		},
		{
			name:     "undecodable, no HTTP status at all",
			res:      Result{ExitCode: 1, Stderr: []byte("gh: something went sideways")},
			wantKind: KindForbidden,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status := classify("github.com", c.res, c.runErr, c.ctxErr)
			if status.Kind != c.wantKind {
				t.Fatalf("classify(%+v) kind = %q, want %q (reason: %q)", c.res, status.Kind, c.wantKind, status.Reason)
			}
			if c.wantReason != "" && !containsFold(status.Reason, c.wantReason) {
				t.Fatalf("classify(%+v) reason = %q, want it to contain %q", c.res, status.Reason, c.wantReason)
			}
		})
	}
}

func containsFold(s, substr string) bool {
	sl, subl := []rune(s), []rune(substr)
	toLower := func(rs []rune) []rune {
		out := make([]rune, len(rs))
		for i, r := range rs {
			if r >= 'A' && r <= 'Z' {
				r += 'a' - 'A'
			}
			out[i] = r
		}
		return out
	}
	s2, sub2 := string(toLower(sl)), string(toLower(subl))
	for i := 0; i+len(sub2) <= len(s2); i++ {
		if s2[i:i+len(sub2)] == sub2 {
			return true
		}
	}
	return len(sub2) == 0
}

func TestIsRateLimited(t *testing.T) {
	rl := Status{Kind: KindForbidden, Reason: "GitHub API rate limit exhausted — try again later"}
	if !isRateLimited(rl) {
		t.Fatal("isRateLimited(rate-limited forbidden) = false, want true")
	}
	other := Status{Kind: KindForbidden, Reason: "not found, or you cannot see it"}
	if isRateLimited(other) {
		t.Fatal("isRateLimited(404-shaped forbidden) = true, want false")
	}
	notForbidden := Status{Kind: KindUnauthenticated, Reason: "rate limit"}
	if isRateLimited(notForbidden) {
		t.Fatal("isRateLimited(unauthenticated) = true, want false — only Kind==forbidden counts")
	}
}

func TestHttpStatusFromStderr(t *testing.T) {
	code, ok := httpStatusFromStderr("gh: Bad credentials (HTTP 401)")
	if !ok || code != 401 {
		t.Fatalf("httpStatusFromStderr = (%d, %v), want (401, true)", code, ok)
	}
	if _, ok := httpStatusFromStderr("no status here"); ok {
		t.Fatal("httpStatusFromStderr found a status in text with none")
	}
}
