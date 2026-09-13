package porcelain

import (
	"fmt"
	"strings"
)

// MergeTreeArgs builds `merge-tree --write-tree --messages --name-only [--merge-base=<sha>]
// <base> <other>` — the option before the two revisions (D13). mergeBase == "" omits
// --merge-base, letting git pick its own; the revert prediction always supplies one (probe P4:
// without it, git picks a base that reports a genuinely conflicting revert as clean).
func MergeTreeArgs(base, other, mergeBase string) []string {
	args := []string{"merge-tree", "--write-tree", "--messages", "--name-only"}
	if mergeBase != "" {
		args = append(args, "--merge-base="+mergeBase)
	}
	return append(args, base, other)
}

// MergePrediction is merge-tree's own parsed outcome — Kind "clean" (TreeID/Messages populated,
// Paths empty) or "conflicts" (Paths/Messages populated). D14: exit 0 is clean, exit 1 is
// conflicts — both real, non-error outcomes; only exitCode > 1 is a spawn failure, classified by
// the caller through gitclient.Classify, never here.
type MergePrediction struct {
	Kind     string // "clean" | "conflicts"
	TreeID   string
	Paths    []string
	Messages []string
}

// blockify groups lines into blank-line-separated blocks, dropping the separators.
func blockify(lines []string) [][]string {
	var blocks [][]string
	var cur []string
	for _, line := range lines {
		if line == "" {
			if len(cur) > 0 {
				blocks = append(blocks, cur)
				cur = nil
			}
			continue
		}
		cur = append(cur, line)
	}
	if len(cur) > 0 {
		blocks = append(blocks, cur)
	}
	return blocks
}

func flatten(blocks [][]string) []string {
	var out []string
	for _, b := range blocks {
		out = append(out, b...)
	}
	return out
}

// ParseMergeTreeOutput parses MergeTreeArgs' own LF-terminated stdout (no -z mode exists;
// merge-tree's output — a tree oid, paths, fixed messages — can never contain a raw LF), gated on
// exitCode exactly as D14 requires: 0 or 1 only, anything else is the caller's own error to
// classify, never this parser's.
func ParseMergeTreeOutput(stdout []byte, exitCode int) (MergePrediction, error) {
	if exitCode != 0 && exitCode != 1 {
		return MergePrediction{}, fmt.Errorf("porcelain: merge-tree exited %d, not a clean/conflict result", exitCode)
	}
	lines := strings.Split(string(stdout), "\n")
	treeID := ""
	if len(lines) > 0 {
		treeID = lines[0]
	}
	rest := lines
	if len(lines) > 0 {
		rest = lines[1:]
	}
	blocks := blockify(rest)

	if exitCode == 0 {
		return MergePrediction{Kind: "clean", TreeID: treeID, Messages: flatten(blocks)}, nil
	}
	var paths []string
	var messageBlocks [][]string
	if len(blocks) > 0 {
		paths = blocks[0]
		messageBlocks = blocks[1:]
	}
	return MergePrediction{Kind: "conflicts", Paths: paths, Messages: flatten(messageBlocks)}, nil
}
