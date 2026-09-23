package porcelain

import "strings"

// EmptyTreeHashArgs builds `hash-object -t tree /dev/null` — the empty-tree object id, derived
// from THIS repository's own object format rather than assumed (F18): the empty-tree hash is a
// well-known constant, but only within one hash algorithm — SHA-1's is
// "4b825dc642cb6eb9a060e54bf8d69288fbee4904", SHA-256's is a completely different 64-hex value
// (verified against real git 2.43 with --object-format=sha256), so a hardcoded SHA-1-width
// literal silently breaks every unborn-HEAD diff in a SHA-256 repository. Spawning for it is
// exact and future-proof against any later hash algorithm git adds, with no lookup table to keep
// in sync. /dev/null is POSIX-specific, consistent with this app's own macOS/Linux-only scope
// (GIT_CONFIG_GLOBAL=/dev/null is already load-bearing throughout this package's own test
// fixtures).
func EmptyTreeHashArgs() []string {
	return []string{"hash-object", "-t", "tree", "/dev/null"}
}

// ParseEmptyTreeHash trims EmptyTreeHashArgs' own single-line stdout into the bare object id.
func ParseEmptyTreeHash(stdout []byte) string {
	return strings.TrimSpace(string(stdout))
}

// WorkingNumstatArgs is NumstatArgs' working-tree twin: plain `git diff` (never `diff-tree`, which
// operates on two commit trees and cannot reach a working tree at all), combining staged and
// unstaged changes against base in one spawn. base is "HEAD" ordinarily, or the empty-tree hash
// (EmptyTreeHashArgs) when HEAD is unborn — see gitsession.RepoEntry.WorkingDetail, which decides
// which. -M -C matches
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
