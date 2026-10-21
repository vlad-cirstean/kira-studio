// The stack relationship lives EXCLUSIVELY in .git/config, as branch.<name>.kirastackparent /
// branch.<name>.kirastackbase (two keys per branch) — never in the app's own SQLite (RepoID is a
// worktree root, the wrong scope) and never inferred from merge-base (provably wrong the moment a
// parent is amended or rebased). This file is the argv side only: the config read/write builders
// and the one rebase verb the whole restack executor (gitsession/stack.go) spawns. Everything
// here is a pure argv builder — no spawn, no filesystem, table-tested byte-exactly
// in stack_test.go.
package gitops

// StackConfigReadArgs builds `git config --local --null --get-regexp '^branch\..*\.kirastack'`
// (the exact framing): `key\nvalue\0` records, exit 1 on no match, exit 0 on a match.
// `--local` (never the default "all scopes" search) so a user's global config can never inject a
// stack relationship into a repository that never asked for one.
func StackConfigReadArgs() []string {
	return []string{"config", "--local", "--null", "--get-regexp", `^branch\..*\.kirastack`}
}

// StackParentKey/StackBaseKey are the two config keys, lowercased exactly as git itself
// stores them (git lowercases the variable name on write, though the branch name inside
// the subsection keeps its case) — never split on "." (a branch name containing a dot,
// e.g. "feat.x", must round-trip as branch.feat.x.kirastackparent).
func StackParentKey(branch string) string { return "branch." + branch + ".kirastackparent" }
func StackBaseKey(branch string) string   { return "branch." + branch + ".kirastackbase" }

// StackConfigSetArgs builds `git config --local <key> <value>` — the always-succeeding write:
// "not stacked" / "not recorded" is the EMPTY STRING, never an absent key, because `git config
// --unset` on a missing key exits 5, which would make an undo replay of "it previously
// had no parent" report a spurious failure. Every stackSet write and every undo replay of one is
// therefore this same one-shape argv, always exit 0.
func StackConfigSetArgs(key, value string) []string {
	return []string{"config", "--local", key, value}
}

// MergeBaseArgs builds `git merge-base <a> <b>` — the new-base computation at stackSet join
// time (correct by construction, since it runs before either branch has diverged further) and
// the honest fallback when a branch's recorded base is unresolvable (merge-base is the wrong
// answer for restacking an amended parent, but the right one for "what WAS the join point").
// Unresolvable inputs exit 1 with no stdout (runAllowingExit(0,1) is this call's own contract).
func MergeBaseArgs(a, b string) []string {
	return []string{"merge-base", a, b}
}

// RebaseOntoArgs is the one rebase verb: `git rebase --no-autostash --no-update-refs
// --onto <onto> <upstream> <branch>`. --no-autostash and --no-update-refs are passed EXPLICITLY,
// never left to the user's own config, and this is a deliberate safety property, not an optional
// flag:
//
//   - --no-autostash: the preflight already declared the tree clean immediately before this
//     spawns; rebase.autoStash would silently stash a tree that gate just certified, hiding a
//     result the user never asked to defer.
//   - --no-update-refs: with --update-refs (git >= 2.38, at this app's own floor).git
//     restacked a whole linear stack in one command, but ALSO silently moved two branches
//     ("stray", "sibling") that were never named, because they happened to point into the
//     rebased range. A user's own global `rebase.updateRefs = true` would reproduce that exact
//     hazard through these per-branch rebases if this flag were merely omitted rather than
//     affirmatively negated — "nothing this phase adds may ever rewrite a branch the user did
//     not name".
//
// onto is the PARENT'S NAME, not a sha: it resolves at spawn time, i.e. AFTER the parent's own
// rebase already ran earlier in the same restack, which is exactly the correct target even though
// the whole plan was computed before anything moved. upstream is the recorded base sha or the
// merge-base fallback — computed from the pre-restack snapshot, which is exactly right for a
// value that names "where this branch's own commits begin", a fact that does not change as the
// parent moves.
func RebaseOntoArgs(onto, upstream, branch string) []string {
	return []string{"rebase", "--no-autostash", "--no-update-refs", "--onto", onto, upstream, branch}
}
