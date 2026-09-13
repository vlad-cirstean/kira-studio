package gitops

import "regexp"

// BranchCreateArgs builds `git branch <name> <startPoint> [-t <track>]`.
func BranchCreateArgs(name, startPoint string, track *string) []string {
	argv := []string{"branch", name, startPoint}
	if track != nil {
		argv = append(argv, "-t", *track)
	}
	return argv
}

// BranchCreateAndSwitchArgs builds `git switch -c <name> <startPoint>`.
func BranchCreateAndSwitchArgs(name, startPoint string) []string {
	return []string{"switch", "-c", name, startPoint}
}

// BranchSetUpstreamArgs builds `git branch --set-upstream-to=<upstream> <name>` — the second argv
// of a branchCreate request whose explicit track differs from plain DWIM-on-startPoint.
func BranchSetUpstreamArgs(name, upstream string) []string {
	return []string{"branch", "--set-upstream-to=" + upstream, name}
}

// BranchDeleteArgs builds `git branch -d/-D <name>`.
func BranchDeleteArgs(name string, force bool) []string {
	if force {
		return []string{"branch", "-D", name}
	}
	return []string{"branch", "-d", name}
}

// BranchRenameArgs builds `git branch -m <from> <to>`.
func BranchRenameArgs(from, to string) []string {
	return []string{"branch", "-m", from, to}
}

// BranchRevParseArgs is undo-capture read #1: does the branch even still resolve, immediately
// before a delete — this is what makes the recovery sha the one that existed right before the
// delete, not a stale guess.
func BranchRevParseArgs(name string) []string {
	return []string{"rev-parse", "--verify", "refs/heads/" + name}
}

// BranchConfigRegexpArgs is undo-capture read #2: every branch.<name>.* config line, verbatim —
// replayed back through `git config` on undo so .remote/.merge (and anything else set under that
// prefix) comes back exactly, not just the two keys probe P4 happened to name.
//
// G32 round-3 architecture/security review, finding #3: this file used to splice name into the
// pattern unescaped, on the premise that "a branch name containing regex metacharacters only
// widens the match, never narrows it to miss the real one" — true about a false NEGATIVE, but
// exactly backwards about the real risk, a false POSITIVE. A legal git branch name may contain
// POSIX ERE metacharacters (`|` in particular: git's own ref-name rules forbid space, ~, ^, :, ?,
// *, [, \, "..", "@{", but not "|"), and ERE's own precedence rules give `|` the LOWEST binding —
// a branch named "x|y" turns `^branch\.x|y\.` into "starts with branch.x, OR contains y." ANYWHERE
// in the key — capturing config lines for unrelated branches, or unrelated sections entirely, that
// this delete never touched. Those over-captured lines are then queued into the undo record's own
// Replay list (captureBranchDeleteUndo, ops.go) as unconditional `git config <key> <value>` SETs —
// so undoing THIS branch's delete could silently overwrite some other, wholly unrelated config key
// back to a stale captured value. regexp.QuoteMeta escapes exactly POSIX ERE's own metacharacter
// set (`\.+*?()|[]{}^$`), so the escaped name can only ever match itself, literally.
func BranchConfigRegexpArgs(name string) []string {
	return []string{"config", "--get-regexp", `^branch\.` + regexp.QuoteMeta(name) + `\.`}
}
