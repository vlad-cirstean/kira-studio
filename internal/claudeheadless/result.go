package claudeheadless

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

const maxDenials = 50

// ResultOutcome maps a `result` event that ended the run in failure (budget, turn limit, error) to
// an outcome. ok is false when the event says nothing about the end.
func ResultOutcome(res *Result, exit int, budgetUSD float64) (runoutcome.Outcome, bool) {
	if res == nil {
		return runoutcome.Outcome{}, false
	}
	code := exit
	switch {
	case res.Subtype == "error_max_budget_usd":
		return runoutcome.Outcome{Status: runoutcome.StatusFailed, Source: runoutcome.SourceBudget, ExitCode: &code,
			Reason: fmt.Sprintf("stopped at the budget of %g USD", budgetUSD)}, true
	case res.Subtype == "error_max_turns":
		return runoutcome.Outcome{Status: runoutcome.StatusFailed, Source: runoutcome.SourceAgent, ExitCode: &code,
			Reason: "stopped at the turn limit"}, true
	case res.IsError:
		return runoutcome.Outcome{Status: runoutcome.StatusFailed, Source: runoutcome.SourceAgent, ExitCode: &code,
			Reason: FirstNonEmpty(res.Text, "Claude reported an error")}, true
	}
	return runoutcome.Outcome{}, false
}

// ApplyResult adds the cost and the permission denials of a `result` event to an outcome.
func ApplyResult(out runoutcome.Outcome, res *Result) runoutcome.Outcome {
	if res == nil {
		return out
	}
	out.CostUSD = res.CostUSD
	if len(res.Denials) > 0 {
		denials := res.Denials
		if len(denials) > maxDenials {
			denials = denials[:maxDenials]
		}
		sort.Strings(denials)
		out.PermissionDenials = denials
		if out.Status != runoutcome.StatusDone {
			out.Reason = strings.TrimSpace(out.Reason + " (denied: " + strings.Join(denials, ", ") + ")")
		}
	}
	return out
}

// FirstNonEmpty returns the first value with visible text.
func FirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
