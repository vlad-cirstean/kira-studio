package gitops

import "strconv"

// RevertArgs builds `git revert --no-edit [-m <mainline>] [--no-commit] <shas...>` — one
// invocation for every sha in the request (§7.10's all-or-nothing is --abort restoring the
// pre-revert state, not this file chunking the list into several spawns). --no-edit always: v1
// has no commit-message editor of its own, and GIT_EDITOR=true would otherwise silently accept
// whatever git's own default message is — --no-edit states that choice in the argv itself.
func RevertArgs(shas []string, mainline *int, noCommit bool) []string {
	argv := []string{"revert", "--no-edit"}
	if mainline != nil {
		argv = append(argv, "-m", strconv.Itoa(*mainline))
	}
	if noCommit {
		argv = append(argv, "--no-commit")
	}
	return append(argv, shas...)
}
