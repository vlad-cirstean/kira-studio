package gitops

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
// prefix) comes back exactly, not just the two keys probe P4 happened to name. name is not
// regex-escaped: --get-regexp treats the whole pattern as a POSIX ERE, but a branch name
// containing regex metacharacters only widens the match, never narrows it to miss the real one.
func BranchConfigRegexpArgs(name string) []string {
	return []string{"config", "--get-regexp", `^branch\.` + name + `\.`}
}
