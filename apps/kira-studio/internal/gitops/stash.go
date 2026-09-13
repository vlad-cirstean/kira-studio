package gitops

import "strconv"

// StashPushArgs builds `stash push [-u] [-k] [-m <message>] [-- <paths...>]` (probe 8: a raw sha is
// never used for push — there is nothing to address yet). G28 D14/F16/P22: every generated path is
// prefixed with the `:(literal)` pathspec magic word — `git stash push -- 'x*.txt'` over-matches
// (stashes `xy.txt` too), which is a real glob-injection-style bug in code that was already shipped,
// even though every caller in this repo passes an empty paths slice today and so never reaches it.
// G27 D18: paths themselves are repository-relative and handed straight back to git — tier 2, never
// NFC-normalized (gitpath.NFC/CleanNFC do not appear anywhere in this file).
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
		for _, p := range paths {
			args = append(args, ":(literal)"+p)
		}
	}
	return args
}

// AutoStashMessagePrefix is G28 D1's own deliberate marker: the literal text prepended to every
// auto-stash's own message (before git itself further prepends "On <originBranch>: "). Used
// server-side only to BUILD the message (AutoStashMessage below); client-side, stashListModel.ts
// uses the very same literal to render an "auto" badge on the row. A user could type this by hand —
// the doc comment there says so — but nothing anywhere BRANCHES on it; it is cosmetic only.
const AutoStashMessagePrefix = "auto-stash: "

// AutoStashMessage builds G28 D1's own auto-stash message — "auto-stash: switching to <target>".
// Never contains a newline (target is always a resolved ref/branch name or a sha, never
// free-form text), which matters because the message becomes a single reflog-subject line every
// reader of the stash list (porcelain.parseBranchFromMessage included) depends on staying one line.
func AutoStashMessage(target string) string {
	return AutoStashMessagePrefix + "switching to " + target
}

// StashCreateArgs builds `stash create [<label>]` (probe P4) — produces a stash-shaped commit
// WITHOUT touching the worktree, the index, or refs/stash at all: git's own latitude for a
// read-pool spawn that only writes loose objects, the same latitude stashPopPrediction's own
// `merge-tree --write-tree` already takes. Probe P5: `-u` is not supported here — a label
// containing "-u" would be consumed as the message's own first token by git's own flag parsing if
// this were built any other way, which is exactly why label is passed as ONE positional argument,
// never split.
func StashCreateArgs(label string) []string {
	return []string{"stash", "create", label}
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

// StashBranchByShaArgs builds `stash branch <name> <sha>` — G28 D12's own sha-addressed arm for a
// GLOBAL stash entry: probe 8 found `stash branch` applies but SILENTLY NEVER DROPS when given a
// raw sha instead of a stash@{N} position, which for a keep-forever bucket entry is precisely the
// desired behaviour (there is no position to drop from in the first place, and the entry must
// survive the branch creation regardless).
func StashBranchByShaArgs(name, sha string) []string {
	return []string{"stash", "branch", name, sha}
}

// GlobalStashRefPrefix is G28 D8's own reserved namespace: one git ref per global-stash entry,
// `refs/kira/globalstash/<sha>` — chosen over a reflog-backed namespace mirroring refs/stash's own
// shape because probe P7 found `git reflog expire --all` WIPES a custom ref's reflog entirely (git
// special-cases only refs/stash itself to never expire), while probe P8 found one ref per entry
// survives the most aggressive prune git offers (`gc --prune=now --aggressive` plus
// `reflog expire --expire-unreachable=now --all`) because every ref is a gc root by construction.
// Every `refs/kira/` string anywhere in this codebase must be built from this constant — never
// hand-spelled (§7.2 item 16).
const GlobalStashRefPrefix = "refs/kira/globalstash/"

// GlobalStashRef builds one entry's own ref name — the ref name IS the entry's identity (D8): it
// is derived from the stash commit's own sha, not generated, so it needs no validation, no
// Unicode handling, no escaping, and saving identical content twice is idempotent by construction
// (probe P10).
func GlobalStashRef(sha string) string {
	return GlobalStashRefPrefix + sha
}

// GlobalStashSetArgs builds `update-ref <ref> <sha>` — globalStashSave's own one-argv write (D10),
// and globalStashRemove's own undo replay (D11): re-creating an identical ref at an identical
// object is idempotent (probe P10), so this same builder serves both.
func GlobalStashSetArgs(sha string) []string {
	return []string{"update-ref", GlobalStashRef(sha), sha}
}

// GlobalStashDeleteArgs builds `update-ref -d <ref> <sha>` — the EXPECTED-OLD-VALUE form (D11), so
// a concurrent change to the same ref refuses rather than silently deleting whatever now sits
// there. Probe P10: `update-ref -d` on a ref that does not exist at all exits 0 SILENTLY — this is
// why globalStashRemove's own Prepare verifies existence host-side (GlobalStashRefExistsArgs)
// before ever spawning this.
func GlobalStashDeleteArgs(sha string) []string {
	return []string{"update-ref", "-d", GlobalStashRef(sha), sha}
}

// GlobalStashRefExistsArgs builds `for-each-ref --format=%(objectname) <ref>` scoped to exactly
// one entry's own ref — globalStashRemove's own required existence check (D11/probe P10: without
// this, `update-ref -d` on an absent ref would make "remove nothing" look like a successful
// removal).
func GlobalStashRefExistsArgs(sha string) []string {
	return []string{"for-each-ref", "--format=%(objectname)", GlobalStashRef(sha)}
}

// GlobalStashListRefsArgs builds `for-each-ref --format=%(objectname) refs/kira/globalstash/` —
// globalStash.list's own first spawn (D9): the sha set. An empty bucket answers exit 0 with empty
// output (probe P10), which is globalStash.list's own signal to return no entries and skip the
// second (log) spawn entirely.
func GlobalStashListRefsArgs() []string {
	return []string{"for-each-ref", "--format=%(objectname)", GlobalStashRefPrefix}
}

// CommitTreeArgs builds `commit-tree <tree> -p <parent> [-p <parent>...] -m <message>` — the
// mechanism both of globalStashSave's own two sources share: promoting an existing stash-stack/
// global entry (D10 step 3) preserves that entry's own tree AND parent list (base, index, and the
// untracked helper commit when present) under a NEW subject, exactly as probe P23 confirmed
// produces a commit that applies identically and that `git stash show` still renders correctly.
func CommitTreeArgs(tree string, parents []string, message string) []string {
	args := []string{"commit-tree", tree}
	for _, p := range parents {
		args = append(args, "-p", p)
	}
	return append(args, "-m", message)
}
