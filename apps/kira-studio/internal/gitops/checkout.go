// Package gitops is the argv-builder half of G5's write path (D4): checkout/branch/tag/revert
// argv, the .git state-file reader with its continue/abort/skip tables, and the operation-level
// error classifier. It holds no policy at all — nothing here decides WHETHER to run a command,
// only how to shape it once gitpreflight (pure) or gitsession (stateful) has decided to. Created
// with exactly what G5 spawns; G7/G12/G13 each add one file beside these with no rework of
// anything here.
package gitops

// SwitchArgs builds `git switch --no-guess <branch>`, with --discard-changes when discard is true
// (§7.5's "discard" route — never offered for an untracked block, probe P9). --no-guess (probe
// P7): without it, `git switch topic` silently creates a local branch tracking `origin/topic`
// when only the remote-tracking ref exists — CheckoutPreflight.createsTracking turns that same
// case into a labelled choice instead, so this file must never let git make it silently.
func SwitchArgs(branch string, discard bool) []string {
	if discard {
		return []string{"switch", "--no-guess", "--discard-changes", branch}
	}
	return []string{"switch", "--no-guess", branch}
}

// SwitchDetachArgs builds `git switch --detach <target>` — a tag, a raw sha, or an explicitly
// detached remote-tracking checkout. --no-guess has no effect on --detach (there is nothing to
// guess a branch name from) but costs nothing to keep, so every `switch` invocation this package
// builds carries it uniformly (§7.3's own exit criterion).
func SwitchDetachArgs(target string, discard bool) []string {
	if discard {
		return []string{"switch", "--no-guess", "--discard-changes", "--detach", target}
	}
	return []string{"switch", "--no-guess", "--detach", target}
}

// SwitchCreateTrackingArgs builds `git switch -c <branch> <upstream>` — the executor's route for
// CheckoutPreflight.createsTracking: `switch -c` with a remote-tracking start point sets up
// tracking automatically (git's own default branch.autoSetupMerge behaviour). No --no-guess here:
// -c already names the branch explicitly, so there is nothing left to guess.
func SwitchCreateTrackingArgs(branch, upstream string, discard bool) []string {
	if discard {
		return []string{"switch", "--discard-changes", "-c", branch, upstream}
	}
	return []string{"switch", "-c", branch, upstream}
}

// RewrittenPathsArgs is T: the paths target's checkout would rewrite relative to HEAD — a read,
// never a write.
func RewrittenPathsArgs(target string) []string {
	return []string{"diff", "--name-only", "-z", "HEAD", target}
}
