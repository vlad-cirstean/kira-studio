package gitops

import "strconv"

// StashPushArgs builds `stash push [-u] [-k] [-m <message>] [-- <paths...>]` (probe 8: a raw sha is
// never used for push — there is nothing to address yet).
func StashPushArgs(message *string, includeUntracked, keepIndex bool, paths []string) []string {
	args := []string{"stash", "push"}
	if includeUntracked {
		args = append(args, "-u")
	}
	if keepIndex {
		args = append(args, "-k")
	}
	if message != nil {
		args = append(args, "-m", *message)
	}
	if len(paths) > 0 {
		args = append(args, "--")
		args = append(args, paths...)
	}
	return args
}

// StashApplyArgs builds `stash apply [--index] <sha>` — apply accepts a raw sha directly (probe 8),
// so no stash@{index} translation is needed here at all.
func StashApplyArgs(sha string, restoreIndex bool) []string {
	args := []string{"stash", "apply"}
	if restoreIndex {
		args = append(args, "--index")
	}
	return append(args, sha)
}

// StashPopArgs builds `stash pop [--index] stash@{<index>}` — pop REFUSES a raw sha (probe 8), so
// this addresses by stack position; the caller verifies `rev-parse stash@{index} == sha`
// immediately before this runs (D6's own reclassification step reuses that same read).
func StashPopArgs(index int, restoreIndex bool) []string {
	args := []string{"stash", "pop"}
	if restoreIndex {
		args = append(args, "--index")
	}
	return append(args, stashRef(index))
}

// StashDropArgs builds `stash drop stash@{<index>}` — same addressing rule as pop.
func StashDropArgs(index int) []string {
	return []string{"stash", "drop", stashRef(index)}
}

// StashBranchArgs builds `stash branch <name> stash@{<index>}` — `stash branch` applies but
// SILENTLY NEVER DROPS when given a raw sha (probe 8), so, like pop and drop, this always addresses
// by stack position, never by sha.
func StashBranchArgs(name string, index int) []string {
	return []string{"stash", "branch", name, stashRef(index)}
}

// StashRevParseArgs is the sha-verification spawn (`rev-parse stash@{<index>}`) pop/drop/branch's
// own Prepare functions run immediately before writing — the contract's own "the service
// verifies... immediately before writing" convention (contract.ts:603-604).
func StashRevParseArgs(index int) []string {
	return []string{"rev-parse", stashRef(index)}
}

func stashRef(index int) string {
	return "stash@{" + strconv.Itoa(index) + "}"
}

// StashStoreArgs builds `stash store -m <message> <sha>` — stashDrop's own undo replay (D6's
// analogue for branchDelete/tagDelete's own capture-before/replay-after undo shape): re-inserts a
// dropped stash back onto the top of the stack under the same message it had.
func StashStoreArgs(message, sha string) []string {
	return []string{"stash", "store", "-m", message, sha}
}
