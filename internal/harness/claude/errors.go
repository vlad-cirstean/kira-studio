package claude

import "github.com/kirathecat/kira-studio/internal/harness"

var (
	errNotFound    = &harness.Error{Kind: harness.ErrNotFound, Msg: "Claude Code CLI not found. Install it, then retry."}
	errAuth        = &harness.Error{Kind: harness.ErrAuth, Msg: "Claude Code is not logged in. Run `claude` once to log in."}
	errBudget      = &harness.Error{Kind: harness.ErrBudget, Msg: "Claude Code call exceeded its cost budget."}
	errMaxTurns    = &harness.Error{Kind: harness.ErrMaxTurns, Msg: "Claude Code call hit its turn limit."}
	errTimeout     = &harness.Error{Kind: harness.ErrTimeout, Msg: "Claude Code call timed out."}
	errOutput      = &harness.Error{Kind: harness.ErrOutput, Msg: "Claude Code returned output the memory store could not use."}
	errOutdated    = &harness.Error{Kind: harness.ErrOutdated, Msg: "Claude Code CLI is too old for the memory store. Update Claude Code, then retry."}
	errRateLimited = &harness.Error{Kind: harness.ErrRateLimited, Msg: "Claude Code is rate limited. Retry shortly."}
	errUsageLimit  = &harness.Error{Kind: harness.ErrUsageLimit, Msg: "Claude usage limit reached. Resume the import when it resets."}
)

// Fail is the user-facing error of kind; a kind this provider does not define comes back as is.
func (*Provider) Fail(kind error) error {
	for _, e := range []*harness.Error{errNotFound, errAuth, errBudget, errMaxTurns, errTimeout, errOutput, errOutdated, errRateLimited, errUsageLimit} {
		if e.Kind == kind {
			return e
		}
	}
	return kind
}
