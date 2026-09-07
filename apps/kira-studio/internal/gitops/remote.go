package gitops

// RefUpdate mirrors @kira/git-ipc's own RefUpdate field for field (D5's encoding rule: null, not
// omitted, for "created"/"deleted") — lives here rather than in gitsession since both producers,
// this package's own porcelain parser (push.go) and gitsession's ref-snapshot diff, need it (D13).
type RefUpdate struct {
	Ref    string  `json:"ref"`
	From   *string `json:"from"`
	To     *string `json:"to"`
	Forced bool    `json:"forced"`
}

// RemotesArgs builds `git remote` — one name per line, D23's auto-fetch remote-selection read.
func RemotesArgs() []string {
	return []string{"remote"}
}

// RemoteTipArgs builds `git rev-parse -q --verify refs/remotes/<remote>/<branch>` — tolerated
// through the caller's own runAllowingExit (exit 1 == the remote-tracking ref does not exist,
// F15).
func RemoteTipArgs(remote, branch string) []string {
	return []string{"rev-parse", "-q", "--verify", "refs/remotes/" + remote + "/" + branch}
}

// AheadBehindArgs builds `git rev-list --left-right --count <branch>...<upstream>` (probe P11:
// "1\t0" = ahead, behind). The caller must guard this on upstream actually resolving first (F15) —
// run against a nonexistent ref it exits 128 with "fatal: ambiguous argument".
func AheadBehindArgs(branch, upstream string) []string {
	return []string{"rev-list", "--left-right", "--count", branch + "..." + upstream}
}

// PullConfigArgs builds the strategy ladder's own single spawn (D18/F16):
// `git config --null --get-regexp '^(pull\.(rebase|ff)|branch\.<branch>\.rebase)$'`. --null frames
// records with NUL and separates key from value with a newline (probe P10) — not the space-
// separated form gitops.BranchConfigRegexpArgs' own caller already parses, a different format.
func PullConfigArgs(branch string) []string {
	pattern := `^(pull\.(rebase|ff)|branch\.` + branch + `\.rebase)$`
	return []string{"config", "--null", "--get-regexp", pattern}
}

// CoreAskPassArgs builds `git config --get core.askPass` — D10's own per-entry, lazy,
// once-per-RepoEntry read (tolerated exit 1: no such config is the common case).
func CoreAskPassArgs() []string {
	return []string{"config", "--get", "core.askPass"}
}

// IsAncestorArgs builds `git merge-base --is-ancestor <a> <b>` — D13's fetch-side "was this
// ref-move a fast-forward" check (exit 0 == a is an ancestor of b, not forced; exit 1 == forced).
func IsAncestorArgs(a, b string) []string {
	return []string{"merge-base", "--is-ancestor", a, b}
}
