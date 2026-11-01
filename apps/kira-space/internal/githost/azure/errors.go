package azure

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/internal/toolexec"
)

const (
	reasonExtension = "run `az extension add --name azure-devops`"
	reasonDefaults  = "set a default organization: `az devops configure --defaults organization=https://dev.azure.com/<org>`"
	reasonThrottled = "Azure DevOps throttled the request — try again later"
	reasonDenied    = "your account lacks permission"
	writeTimeoutMsg = "az did not respond within %ds. The request may have been recorded; open the PR to check before trying again"
)

// timeoutError is a spawn that outlived its own deadline; it matches context.DeadlineExceeded.
type timeoutError struct{ after time.Duration }

func (e timeoutError) Error() string {
	return fmt.Sprintf("az did not respond within %ds", int(e.after.Seconds()))
}

func (e timeoutError) Is(target error) bool { return target == context.DeadlineExceeded }

func signInReason(org string) string {
	return "Sign in with `az login`, or `az devops login --organization " + org + "` with a PAT"
}

// gone is the Status of a repository Azure DevOps does not show to the viewer.
func gone(org string) githost.Status {
	return githost.Status{Kind: githost.KindForbidden, Host: Host, Site: org, Reason: "not found, or you cannot see it", Gone: true}
}

func status(org, kind, reason string) githost.Status {
	return githost.Status{Kind: kind, Host: Host, Site: org, Reason: reason}
}

// httpCode matches a bare HTTP status, not the digits inside an id such as TF401027.
func httpCode(code string) *regexp.Regexp {
	return regexp.MustCompile(`(^|[^0-9a-z])` + code + `([^0-9a-z]|$)`)
}

var (
	re401 = httpCode("401")
	re403 = httpCode("403")
	re404 = httpCode("404")
	re429 = httpCode("429")
)

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// classify is the one place an az exit or stderr line becomes a Status. Callers check ctxErr (the
// caller's own context) first so a cancellation never reads as an Azure failure. A write that
// timed out may have landed, so its reason says so.
func classify(org string, runErr, ctxErr error, write bool) githost.Status {
	var timeout timeoutError
	switch {
	case runErr == nil && ctxErr == nil:
		return status(org, githost.KindOK, "")
	case ctxErr != nil:
		return status(org, githost.KindNotFound, "cancelled")
	case errors.As(runErr, &timeout):
		if write {
			return status(org, githost.KindNotFound, fmt.Sprintf(writeTimeoutMsg, int(timeout.after.Seconds())))
		}
		return status(org, githost.KindNotFound, timeout.Error())
	case errors.Is(runErr, context.DeadlineExceeded):
		return status(org, githost.KindNotFound, "az did not respond in time")
	case errors.Is(runErr, toolexec.ErrOutputTooLarge):
		return status(org, githost.KindForbidden, "Azure DevOps' response was too large to read")
	}
	var ee *toolexec.ExecError
	if !errors.As(runErr, &ee) {
		return status(org, githost.KindNotFound, "az could not be started: "+runErr.Error())
	}
	line := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(ee.Stderr), "ERROR:"))
	lower := strings.ToLower(ee.Stderr)
	switch {
	case containsAny(lower, "before you can run azure devops commands", "please run 'az login'", "tf400813", "aadsts") || re401.MatchString(lower):
		return status(org, githost.KindUnauthenticated, signInReason(org))
	case containsAny(lower, "'repos' is misspelled", "'devops' is misspelled") ||
		(strings.Contains(lower, "extension") && strings.Contains(lower, "not installed")):
		return status(org, githost.KindNotFound, reasonExtension)
	case containsAny(lower, "tf400733", "exceeding usage", "too many requests") || re429.MatchString(lower):
		s := status(org, githost.KindForbidden, reasonThrottled)
		s.RateLimited = true
		return s
	case containsAny(lower, "tf401180", "tf401019", "tf200016", "does not exist", "could not be found") || re404.MatchString(lower):
		return gone(org)
	case containsAny(lower, "tf401027", "permission") || re403.MatchString(lower):
		return status(org, githost.KindForbidden, reasonDenied)
	case line == "":
		return status(org, githost.KindForbidden, fmt.Sprintf("az exited with code %d", ee.ExitCode))
	}
	return status(org, githost.KindForbidden, line)
}
