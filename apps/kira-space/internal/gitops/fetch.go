package gitops

// FetchArgs builds `git fetch --progress [--prune] [--prune-tags] <remote>` (D12). --progress
// always: the child is never a tty (gitclient.Spec.Setsid guarantees it for every remote-op spawn),
// and without the flag git emits no progress lines at all.
func FetchArgs(remote string, prune, pruneTags bool) []string {
	argv := []string{"fetch", "--progress"}
	if prune {
		argv = append(argv, "--prune")
	}
	if pruneTags {
		argv = append(argv, "--prune-tags")
	}
	return append(argv, remote)
}

// FetchRefspecArgs builds pull's own step 1 (D12/D18): a fully-qualified refspec on both sides
// (F14), fetching exactly the one branch the integrate phase is about to merge/rebase onto.
// --prune-tags is never offered here: a pull is scoped to one branch, and pruning every
// local-only tag on every pull would be a much bigger blast radius than the user asked for.
func FetchRefspecArgs(remote, branch string, prune bool) []string {
	argv := []string{"fetch", "--progress"}
	if prune {
		argv = append(argv, "--prune")
	}
	refspec := "refs/heads/" + branch + ":refs/remotes/" + remote + "/" + branch
	return append(argv, remote, refspec)
}
