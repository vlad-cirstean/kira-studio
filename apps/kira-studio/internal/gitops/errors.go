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
	// G7 D14/F18: eight rows prepended, in this exact order, ahead of every G5 row below — "not
	// found" would otherwise swallow RemoteNotFound, and a broad "! [rejected]" would swallow the
	// two lease kinds. Every pattern here is verbatim from a real failure this chapter's own
	// probes observed against real git and a real 401.
	case strings.Contains(lower, "hook declined"):
		return "HookRejected", message
	case strings.Contains(lower, "(stale info)"):
		return "LeaseViolation", message
	case strings.Contains(lower, "(remote ref updated since checkout)"):
		return "RemoteRefUpdated", message
	case strings.Contains(lower, "! [rejected]") || strings.Contains(lower, "non-fast-forward") ||
		strings.Contains(lower, "fetch first"):
		return "NonFastForward", message
	case strings.Contains(lower, "terminal prompts disabled") || strings.Contains(lower, "could not read username") ||
		strings.Contains(lower, "could not read password") || strings.Contains(lower, "authentication failed for") ||
		strings.Contains(lower, "unable to read askpass response"):
		return "AuthFailed", message
	case strings.Contains(lower, "could not resolve host") || strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "connection timed out") || strings.Contains(lower, "unable to access '"):
		return "NetworkFailed", message
	case strings.Contains(lower, "does not appear to be a git repository") || strings.Contains(lower, "repository not found"):
		return "RemoteNotFound", message
	case strings.Contains(lower, "remote ref does not exist") || strings.Contains(lower, "unable to delete '"):
		return "RemoteRefMissing", message

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

// ClassifyRemoteError is D14's own entry point for a remote op's failure: porcelainReason (the
// parenthesised text from the first rejected line of a push's --porcelain block — "" for fetch, or
// for a push whose block came back empty, probe P8) is matched FIRST, then stderr falls through to
// ClassifyOpError's own table — whose eight prepended rows above cover exactly the cases
// porcelainReason does not (AuthFailed/NetworkFailed/RemoteNotFound/RemoteRefMissing have no
// porcelain shape at all; the plain, no-porcelain form of NonFastForward is stderr-only too,
// probe P5).
func ClassifyRemoteError(porcelainReason, stderr string, exitCode int) (kind, message string) {
	lower := strings.ToLower(porcelainReason)
	switch {
	case strings.Contains(lower, "hook declined"):
		return "HookRejected", strings.TrimSpace(stderr)
	case strings.Contains(lower, "stale info"):
		return "LeaseViolation", strings.TrimSpace(stderr)
	case strings.Contains(lower, "remote ref updated since checkout"):
		return "RemoteRefUpdated", strings.TrimSpace(stderr)
	case strings.Contains(lower, "fetch first") || strings.Contains(lower, "non-fast-forward"):
		return "NonFastForward", strings.TrimSpace(stderr)
	}
	return ClassifyOpError(stderr, exitCode)
}

// ExtractRemoteMessage is RemoteOpResult.error.remoteMessage's own source (F17/P7): every stderr
// line beginning "remote: ", prefix stripped and right-trimmed (git pads these lines with trailing
// spaces), joined with "\n". "" when there are none — the caller decides whether to surface it at
// all (only ever for a HookRejected, per the contract's own doc comment).
func ExtractRemoteMessage(stderr string) string {
	var lines []string
	for _, line := range strings.Split(stderr, "\n") {
		if rest, ok := strings.CutPrefix(line, "remote: "); ok {
			lines = append(lines, strings.TrimRight(rest, " "))
		}
	}
	return strings.Join(lines, "\n")
}
