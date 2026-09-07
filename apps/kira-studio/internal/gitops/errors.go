package gitops

import "strings"

// ClassifyOpError is D14's ordered pattern table over one op's stderr — order matters as much as
// the patterns (a more specific rule must precede the general one it would be swallowed by).
// Scoped to what G5's own ten operations can actually produce; every pattern is verbatim from a
// real failure observed against real git in this chapter's own probes. G7/G12/G13 each prepend or
// append rows to this same table for the error kinds their own operations introduce — never
// widening gitclient.ErrorKind, which stays the five-member SPAWN vocabulary this is not (D14).
//
// A classified operation failure is never an RPC error: op.run's handler does not try/catch (§7's
// own W11) — a non-zero exit here becomes OpResult{ok:false, error:{kind,message}}, never a
// propagated error.
func ClassifyOpError(stderr string, exitCode int) (kind, message string) {
	_ = exitCode // reserved for a future row that needs it; no row in this table does yet.
	lower := strings.ToLower(stderr)
	message = strings.TrimSpace(stderr)

	switch {
	case strings.Contains(lower, "already exists"):
		// upstream probe P4/P3: "a branch named '…' already exists" / "tag '…' already exists".
		return "AlreadyExists", message
	case strings.Contains(lower, "is not fully merged"):
		return "NotFullyMerged", message
	case strings.Contains(lower, "used by worktree at"):
		// Probe P8: covers both the switch refusal ("'x' is already used by worktree at") and the
		// delete refusal ("cannot delete branch 'x' used by worktree at").
		return "WorktreeConflict", message
	case strings.Contains(lower, "is a merge but no -m option was given"):
		// Probe P6 — revert produces this exactly as readily as cherry-pick does.
		return "MainlineRequired", message
	case strings.Contains(lower, "untracked working tree file"):
		// Probe P7: matches both the plural list header and --discard-changes' singular form.
		return "UntrackedWouldBeOverwritten", message
	case strings.Contains(lower, "local changes to the following files would be overwritten"):
		// Probe P7.
		return "DirtyWorktree", message
	case strings.Contains(lower, "cannot switch branch while") ||
		(strings.Contains(lower, "there is no") && strings.Contains(lower, "in progress")):
		// Probe P5.
		return "OperationInProgress", message
	case strings.Contains(lower, "could not apply") || strings.Contains(lower, "could not revert") || strings.Contains(lower, "conflict ("):
		// Probe P5.
		return "Conflict", message
	case strings.Contains(lower, "reference is not a tree:") || strings.Contains(lower, "no branch named") ||
		strings.Contains(lower, "not found") || strings.Contains(lower, "bad object") || strings.Contains(lower, "invalid reference"):
		// upstream probe P7.
		return "NotFound", message
	case strings.Contains(lower, "index.lock") || strings.Contains(lower, "another git process seems to be running"):
		return "LockHeld", message
	default:
		return "Unknown", message
	}
}
