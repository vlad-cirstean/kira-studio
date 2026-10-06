package porcelain

import (
	"strconv"
	"strings"
)

// CherryArgs is `cherry <upstream> <head> <limit>`: the commits of head that are neither reachable
// from upstream nor from limit, each marked `-` when upstream holds an equivalent patch.
func CherryArgs(upstream, head, limit string) []string {
	return []string{"cherry", upstream, head, limit}
}

// ParseCherry counts the `+` (no equivalent upstream) and `-` (equivalent upstream) lines.
func ParseCherry(stdout []byte) (plus, minus int) {
	for _, line := range strings.Split(string(stdout), "\n") {
		switch {
		case strings.HasPrefix(line, "+ "):
			plus++
		case strings.HasPrefix(line, "- "):
			minus++
		}
	}
	return plus, minus
}

// ThreeDotDiffArgs is the PR-shaped diff `diff <base>...<tip>` (merge base to tip), the input a
// squash-merge comparison patch-ids.
func ThreeDotDiffArgs(base, tip string) []string {
	return []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv", base + "..." + tip}
}

// LogPatchArgs is `log --no-merges -p -n <n> <ref>`, the input `patch-id` reads one patch per commit
// from.
func LogPatchArgs(ref string, n int) []string {
	return []string{"log", "--no-merges", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "-n", strconv.Itoa(n), ref, "--"}
}

// PatchIDArgs is `patch-id --stable`: stable ids do not change with file order in the patch.
func PatchIDArgs() []string { return []string{"patch-id", "--stable"} }

// ParsePatchIDs returns the first field (the patch id) of every non-empty output line.
func ParsePatchIDs(stdout []byte) []string {
	var out []string
	for _, line := range strings.Split(string(stdout), "\n") {
		if f := strings.Fields(line); len(f) > 0 {
			out = append(out, f[0])
		}
	}
	return out
}
