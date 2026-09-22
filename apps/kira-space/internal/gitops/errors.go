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
// classifyRule is one classifyOpErrorRules row: a pattern test over the lower-cased stderr plus
// the kind it maps to.
type classifyRule struct {
	match func(lower string) bool
	kind  string
}

// classifyOpErrorRules is ClassifyOpError's own ordered pattern table — order matters as much as
// the patterns (a more specific rule must precede the general one it would be swallowed by). Kept
// as a slice, not a map, for exactly that reason: a map has no order to preserve.
var classifyOpErrorRules = []classifyRule{
	// G7 D14/F18: eight rows prepended, in this exact order, ahead of every G5 row below — "not
	// found" would otherwise swallow RemoteNotFound, and a broad "! [rejected]" would swallow the
	// two lease kinds. Every pattern here is verbatim from a real failure this chapter's own
	// probes observed against real git and a real 401.
	{kind: "HookRejected", match: func(lower string) bool { return strings.Contains(lower, "hook declined") }},
	{kind: "LeaseViolation", match: func(lower string) bool { return strings.Contains(lower, "(stale info)") }},
	{kind: "RemoteRefUpdated", match: func(lower string) bool {
		return strings.Contains(lower, "(remote ref updated since checkout)")
	}},
	{kind: "NonFastForward", match: func(lower string) bool {
		// The last pattern is `merge --ff-only`'s own real message against a diverged branch
		// (probed here, real git 2.43): "fatal: Not possible to fast-forward, aborting." — pull's
		// own integrate phase, not a push, so it never has a porcelain reason to check first.
		return strings.Contains(lower, "! [rejected]") || strings.Contains(lower, "non-fast-forward") ||
			strings.Contains(lower, "fetch first") || strings.Contains(lower, "not possible to fast-forward")
	}},
	{kind: "AuthFailed", match: func(lower string) bool {
		return strings.Contains(lower, "terminal prompts disabled") || strings.Contains(lower, "could not read username") ||
			strings.Contains(lower, "could not read password") || strings.Contains(lower, "authentication failed for") ||
			strings.Contains(lower, "unable to read askpass response")
	}},
	{kind: "NetworkFailed", match: func(lower string) bool {
		return strings.Contains(lower, "could not resolve host") || strings.Contains(lower, "connection refused") ||
			strings.Contains(lower, "connection timed out") || strings.Contains(lower, "unable to access '")
	}},
	{kind: "RemoteNotFound", match: func(lower string) bool {
		return strings.Contains(lower, "does not appear to be a git repository") || strings.Contains(lower, "repository not found")
	}},
	{kind: "RemoteRefMissing", match: func(lower string) bool {
		return strings.Contains(lower, "remote ref does not exist") || strings.Contains(lower, "unable to delete '")
	}},

	{kind: "AlreadyExists", match: func(lower string) bool {
		// upstream probe P4/P3: "a branch named '…' already exists" / "tag '…' already exists".
		return strings.Contains(lower, "already exists")
	}},
	{kind: "NotFullyMerged", match: func(lower string) bool { return strings.Contains(lower, "is not fully merged") }},
	{kind: "WorktreeConflict", match: func(lower string) bool {
		// Probe P8: covers both the switch refusal ("'x' is already used by worktree at") and the
		// delete refusal ("cannot delete branch 'x' used by worktree at").
		return strings.Contains(lower, "used by worktree at")
	}},
	{kind: "MainlineRequired", match: func(lower string) bool {
		// Probe P6 — revert produces this exactly as readily as cherry-pick does.
		return strings.Contains(lower, "is a merge but no -m option was given")
	}},
	{kind: "StashIndexConflict", match: func(lower string) bool {
		// G17 D7/probe 10: `apply --index`/`pop --index` onto an already-conflicted index —
		// `error: conflicts in index. Try without --index.` Distinct from StashConflict: git names
		// its own remedy exactly (retry the same op with restoreIndex: false). Ahead of the
		// "untracked working tree file" row below, matching this table's own "more specific first"
		// rule — not that the two patterns could collide, but D7 groups both stash-specific rows
		// together at the point stash pop/apply's own stderr is classified.
		return strings.Contains(lower, "conflicts in index")
	}},
	{kind: "UntrackedWouldBeOverwritten", match: func(lower string) bool {
		// Probe P7: matches both the plural list header and --discard-changes' singular form. G17
		// D7: for a stash pop/apply specifically, reclassifyStashPop (gitsession/ops.go) remaps this
		// generic kind to StashUntrackedCollision — the identical stderr, but a stash-specific
		// remedy story (probe 3) — since this table has no notion of which op kind is asking.
		return strings.Contains(lower, "untracked working tree file")
	}},
	{kind: "DirtyWorktree", match: func(lower string) bool {
		// Probe P7.
		return strings.Contains(lower, "local changes to the following files would be overwritten")
	}},
	{kind: "DirtyWorktree", match: func(lower string) bool {
		// G26 D5/probe P12: `git rebase --onto` refuses a dirty tree with exactly these two stderr
		// strings — reused DirtyWorktree, not a new kind, the same "different stderr shape, same
		// remedy story" convention this table's other rows already follow.
		return strings.Contains(lower, "cannot rebase: you have unstaged changes") ||
			strings.Contains(lower, "cannot rebase: your index contains uncommitted changes")
	}},
	{kind: "DirtyWorktree", match: func(lower string) bool {
		// G25 D15/probe M4: `worktree remove` on a dirty worktree — "fatal: '<path>' contains
		// modified or untracked files, use --force to delete it". A different stderr shape from the
		// checkout row just above, but the same reused kind (DirtyWorktree): both name "there is
		// uncommitted work in the way", and the client already renders one remedy story for it.
		return strings.Contains(lower, "contains modified or untracked files")
	}},
	{kind: "WorktreeLocked", match: func(lower string) bool {
		// G25 D15/probe M5: `worktree remove` on a locked worktree — "fatal: cannot remove a locked
		// working tree, lock reason: <reason>". A dedicated kind, not folded into LockHeld (which
		// means "another git process holds index.lock" — an entirely different remedy: LockHeld says
		// wait/retry, WorktreeLocked says unlock the worktree first).
		return strings.Contains(lower, "locked working tree")
	}},
	{kind: "OperationInProgress", match: func(lower string) bool {
		// Probe P5.
		return strings.Contains(lower, "cannot switch branch while") ||
			(strings.Contains(lower, "there is no") && strings.Contains(lower, "in progress"))
	}},
	{kind: "Conflict", match: func(lower string) bool {
		// Probe P5.
		return strings.Contains(lower, "could not apply") || strings.Contains(lower, "could not revert") || strings.Contains(lower, "conflict (")
	}},
	{kind: "NotFound", match: func(lower string) bool {
		// upstream probe P7.
		return strings.Contains(lower, "reference is not a tree:") || strings.Contains(lower, "no branch named") ||
			strings.Contains(lower, "not found") || strings.Contains(lower, "bad object") || strings.Contains(lower, "invalid reference")
	}},
	{kind: "NotFound", match: func(lower string) bool {
		// G26 D5/probe P14: `git rebase --onto <onto> <base> <branch>` with a nonexistent <branch>
		// — "fatal: no such branch/commit '<x>'". Its own row rather than widening the existing
		// NotFound pattern list above, so the probe citation sits next to the exact string it came
		// from (D5's own stated reason). Reused NotFound, not a new kind — this phase's only new
		// OpErrorKind is StackCycle, produced exclusively by stackSet.
		return strings.Contains(lower, "no such branch/commit")
	}},
	{kind: "LockHeld", match: func(lower string) bool {
		return strings.Contains(lower, "index.lock") || strings.Contains(lower, "another git process seems to be running")
	}},
}

func ClassifyOpError(stderr string, exitCode int) (kind, message string) {
	_ = exitCode // reserved for a future row that needs it; no row in this table does yet.
	lower := strings.ToLower(stderr)
	message = strings.TrimSpace(stderr)

	for _, rule := range classifyOpErrorRules {
		if rule.match(lower) {
			return rule.kind, message
		}
	}
	return "Unknown", message
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
