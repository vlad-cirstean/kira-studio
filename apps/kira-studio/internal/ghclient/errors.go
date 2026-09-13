package ghclient

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// apiErrorBody is the shape `gh api`'s own JSON error body takes on a non-2xx response — gh prints
// this to stdout even on failure (it is the REST response body verbatim), with the HTTP status
// itself only available via stderr's own "gh: <message> (HTTP <code>)" trailer, which
// classify below parses rather than relying on gh's exit code alone (gh exits 1 for every API
// error regardless of status).
type apiErrorBody struct {
	Message string `json:"message"`
}

// httpStatusFromStderr extracts the numeric status gh's own stderr names — "gh: Bad credentials
// (HTTP 401)" — the one place this package ever needs to know the real status rather than gh's own
// flat exit code.
func httpStatusFromStderr(stderr string) (int, bool) {
	idx := strings.LastIndex(stderr, "(HTTP ")
	if idx < 0 {
		return 0, false
	}
	rest := stderr[idx+len("(HTTP "):]
	end := strings.IndexByte(rest, ')')
	if end < 0 {
		return 0, false
	}
	code, err := strconv.Atoi(strings.TrimSpace(rest[:end]))
	if err != nil {
		return 0, false
	}
	return code, true
}

// classify is D5's full table, the ONE place an HTTP status or a gh exit code is interpreted
// anywhere in this package. res/runErr are Client.get's own raw outcome (a successful `gh api`
// invocation with a non-2xx HTTP status still exits gh 1 with a JSON body on stdout — decoding it
// is a separate, orthogonal step api.go's own get performs); ctxErr is the request ctx's own Err()
// (checked first, exactly like gitclient.Classify's own precedent), so a caller cancellation is
// never misclassified as a GitHub-side failure.
func classify(host string, res Result, runErr, ctxErr error) Status {
	if ctxErr != nil {
		return Status{Kind: KindNotFound, Host: host, Reason: "cancelled"}
	}
	if errors.Is(runErr, context.DeadlineExceeded) {
		return Status{Kind: KindNotFound, Host: host, Reason: "gh api did not respond within 10s"}
	}
	if runErr != nil {
		return Status{Kind: KindNotFound, Host: host, Reason: "gh could not be started: " + runErr.Error()}
	}
	if res.ExitCode == 0 {
		return Status{Kind: KindOK, Host: host}
	}

	stderr := string(res.Stderr)
	lower := strings.ToLower(stderr)
	status, hasStatus := httpStatusFromStderr(stderr)

	message := apiErrorMessage(res.Stdout)

	switch {
	case hasStatus && status == 401:
		return Status{Kind: KindUnauthenticated, Host: host, Reason: "GitHub rejected the request — run `gh auth login`"}
	case hasStatus && status == 403 && (strings.Contains(lower, "rate limit") || strings.Contains(lower, "api rate limit")):
		return Status{Kind: KindForbidden, Host: host, Reason: "GitHub API rate limit exhausted — try again later"}
	case hasStatus && status == 403 && (strings.Contains(lower, "saml") || strings.Contains(lower, "sso")):
		return Status{Kind: KindForbidden, Host: host, Reason: "this organization requires SSO authorization for your token"}
	case hasStatus && status == 403:
		return Status{Kind: KindForbidden, Host: host, Reason: reasonOrDefault(message, "your token lacks the required scope")}
	case hasStatus && status == 429:
		return Status{Kind: KindForbidden, Host: host, Reason: "GitHub API rate limit exhausted — try again later"}
	case hasStatus && status == 404:
		return Status{Kind: KindForbidden, Host: host, Reason: "not found, or you cannot see it"}
	case hasStatus && status >= 500:
		return Status{Kind: KindForbidden, Host: host, Reason: "GitHub did not answer — try again later"}
	default:
		// Undecodable / no recognisable HTTP status at all — D5's own catch-all row.
		return Status{Kind: KindForbidden, Host: host, Reason: reasonOrDefault(message, "GitHub did not answer — try again later")}
	}
}

func apiErrorMessage(stdout []byte) string {
	var body apiErrorBody
	if err := json.Unmarshal(stdout, &body); err != nil {
		return ""
	}
	return body.Message
}

func reasonOrDefault(message, fallback string) string {
	if message != "" {
		return message
	}
	return fallback
}

// isRateLimited reports whether s represents D7's own breaker-arming condition — a rate-limited
// forbidden — distinguishing it from every other forbidden reason (SAML, scope, 404, 5xx), none of
// which should suppress the next call the way an exhausted rate-limit budget must.
func isRateLimited(s Status) bool {
	return s.Kind == KindForbidden && strings.Contains(strings.ToLower(s.Reason), "rate limit")
}
