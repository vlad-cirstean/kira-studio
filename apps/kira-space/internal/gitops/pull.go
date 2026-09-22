package gitops

// MergeFFOnlyArgs builds `git merge --ff-only <upstream>` — pull's integrate phase, ff-only
// strategy. Fails fast (NonFastForward) against a diverged branch rather than doing anything at
// all (D18).
func MergeFFOnlyArgs(upstream string) []string {
	return []string{"merge", "--ff-only", upstream}
}

// MergeArgs builds `git merge --no-edit <upstream>` — pull's integrate phase, merge strategy.
// --no-edit always: v1 has no commit-message editor of its own (the same reasoning RevertArgs'
// own --no-edit states).
func MergeArgs(upstream string) []string {
	return []string{"merge", "--no-edit", upstream}
}

// RebaseArgs builds `git rebase <upstream>` — pull's integrate phase, rebase strategy. A
// conflicting rebase lands in G5's existing in-progress banner, offering Abort and never Continue
// (SPEC's own v1 rebase posture) — this file adds no interactive-rebase support of any kind.
func RebaseArgs(upstream string) []string {
	return []string{"rebase", upstream}
}
