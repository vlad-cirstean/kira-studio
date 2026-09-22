package gitops

import "strconv"

// CherryPickArgs builds `cherry-pick [-m <n>] [--no-commit] <sha>` — mirrors RevertArgs exactly,
// minus --no-edit (a pick never opens a message editor to suppress; it reuses the original
// commit's own message).
func CherryPickArgs(sha string, mainline *int, noCommit bool) []string {
	argv := []string{"cherry-pick"}
	if mainline != nil {
		argv = append(argv, "-m", strconv.Itoa(*mainline))
	}
	if noCommit {
		argv = append(argv, "--no-commit")
	}
	return append(argv, sha)
}
