package porcelain

import (
	"fmt"
	"strings"
)

// RefSnapshotArgs is the paged walk's own narrow ref snapshot (D9) — refname -> object id only,
// deliberately smaller than refs.list's own for-each-ref query (no upstream tracking, no
// worktree path, no tag annotation: those cost git a reachability computation per ref this
// comparison never needs).
//
// No `-z`: for-each-ref's NUL-terminated output (`--nul`/`-z`) is not available on this app's
// git floor (RequiredVersion 2.38 — `-z` was added later; probed here against a real 2.43.0
// binary: "error: unknown switch `z'"). A refname and an object id can never contain a raw
// newline (git's own refname grammar forbids control characters), so the plain, one-record-
// per-line output for-each-ref already produces is a safe, simpler record delimiter for exactly
// this query — ParseRefSnapshot splits on '\n', not NUL.
func RefSnapshotArgs() []string {
	// for-each-ref's own --format has no %x1f hex-escape placeholder (that syntax is `git log
	// --pretty=format:`'s own, confirmed against a real 2.43.0 binary — %x1f passes through
	// verbatim rather than expanding) — a literal 0x1f byte works instead, and does so safely:
	// os/exec never shells out, so this argv byte reaches git exactly as written, and a refname
	// or object id can never itself contain 0x1f (git's own refname grammar forbids control
	// characters).
	return []string{"for-each-ref", "--format=%(refname)\x1f%(objectname)"}
}

// ParseRefSnapshot parses RefSnapshotArgs' own newline-delimited output into a refname -> object
// id map.
func ParseRefSnapshot(raw []byte) (map[string]string, error) {
	text := strings.TrimSuffix(string(raw), "\n")
	if text == "" {
		return map[string]string{}, nil
	}
	lines := strings.Split(text, "\n")
	out := make(map[string]string, len(lines))
	for _, line := range lines {
		fields := SplitLimitedFields([]byte(line), fieldDelim, 2)
		if len(fields) != 2 {
			return nil, fmt.Errorf("porcelain: ref snapshot record has %d fields, want 2", len(fields))
		}
		out[string(fields[0])] = string(fields[1])
	}
	return out, nil
}
