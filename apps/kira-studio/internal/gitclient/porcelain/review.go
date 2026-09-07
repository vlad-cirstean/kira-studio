package porcelain

import (
	"fmt"
	"strconv"
	"strings"
)

// MergeBaseArgs is `merge-base <a> <b>` — the two revisions as two separate argv tokens (unlike
// RangeToken's single two-dot token), which is exactly why gitrpc validates both before either
// reaches here (D8): a `b` beginning with "-" would otherwise be read as a merge-base flag of its
// own rather than a revision.
func MergeBaseArgs(a, b string) []string {
	return []string{"merge-base", a, b}
}

// CountRangeArgs is `rev-list --count <base>..<branch>` — the range-count half of base
// resolution's ready/empty distinction (D7c), sharing RangeToken with RevSetArgs (log.go) so the
// two-dot token has exactly one construction site.
func CountRangeArgs(base, branch string) []string {
	return []string{"rev-list", "--count", RangeToken(RangeSpec{Base: base, Branch: branch})}
}

// OriginHeadArgs is `symbolic-ref --short refs/remotes/origin/HEAD` — the default-branch probe
// (D7c step 2). Its exit code alone does not distinguish "no origin" from "origin/HEAD unset"
// from "dangling" (probe P1); the caller folds all three into "not detected".
func OriginHeadArgs() []string {
	return []string{"symbolic-ref", "--short", "refs/remotes/origin/HEAD"}
}

// ParseCount parses `rev-list --count`'s own single-line integer output — an unparseable body is
// an error naming the output, never a silent 0.
func ParseCount(stdout []byte) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(string(stdout)))
	if err != nil {
		return 0, fmt.Errorf("porcelain: rev-list --count: unparseable output %q: %w", stdout, err)
	}
	return n, nil
}
