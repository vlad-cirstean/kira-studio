package porcelain

// EmptyTreeSHA is git's own well-known empty-tree object id — the "base" side of a working-tree
// diff when HEAD is unborn (no commit exists yet to diff against). Plain `git diff <rev>` refuses a
// rev that does not exist, the same reason NumstatArgs/NameStatusArgs use `--root` for a root
// commit's own diff-tree spawn; there is no `--root`-equivalent flag for plain `diff`, so the
// literal empty-tree sha is the one that works.
const EmptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// WorkingNumstatArgs is NumstatArgs' working-tree twin: plain `git diff` (never `diff-tree`, which
// operates on two commit trees and cannot reach a working tree at all), combining staged and
// unstaged changes against base in one spawn. base is "HEAD" ordinarily, or EmptyTreeSHA when HEAD
// is unborn — see gitsession.RepoEntry.WorkingDetail, which decides which. -M -C matches
// NumstatArgs/NameStatusArgs exactly, so CombineFileChanges' own no-rename-branch join is correct
// here too.
func WorkingNumstatArgs(base string) []string {
	return []string{"diff", "--numstat", "-M", "-C", "-z", base}
}

// WorkingNameStatusArgs is WorkingNumstatArgs' twin over `--name-status` — CombineFileChanges joins
// this onto WorkingNumstatArgs' own additions/deletions/isBinary, identically to the commit-detail
// pair.
func WorkingNameStatusArgs(base string) []string {
	return []string{"diff", "--name-status", "-M", "-C", "-z", base}
}
