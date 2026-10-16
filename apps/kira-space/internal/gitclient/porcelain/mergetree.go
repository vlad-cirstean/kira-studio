package porcelain

import (
	"fmt"
	"strconv"
	"strings"
)

// MergeTreeArgs builds `merge-tree --write-tree --messages --name-only -z [--merge-base=<sha>]
// <base> <other>` — the option before the two revisions (D13). mergeBase == "" omits
// --merge-base, letting git pick its own; the revert prediction always supplies one (probe P4:
// without it, git picks a base that reports a genuinely conflicting revert as clean). -z (F15,
// available since git 2.38) is load-bearing: without it, a conflicted path containing a quote,
// backslash, tab or LF comes back C-quoted (verified against real git 2.43), which
// ParseMergeTreeOutput's own NUL-framed parse never has to unquote at all.
func MergeTreeArgs(base, other, mergeBase string) []string {
	args := []string{"merge-tree", "--write-tree", "--messages", "--name-only", "-z"}
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

// splitNULTerminated splits raw on NUL into its terminated fields, dropping the one empty trailing
// entry a well-formed NUL-terminated stream always ends with (every field, including the last,
// ends in its own \0 — there is nothing meaningful after the final one).
func splitNULTerminated(raw []byte) []string {
	parts := strings.Split(string(raw), "\x00")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	return parts
}

// ParseMergeTreeOutput parses MergeTreeArgs' own NUL-framed stdout (F15: -z, not the default LF
// framing a conflicted path can come back C-quoted under), gated on exitCode exactly as D14
// requires: 0 or 1 only, anything else is the caller's own error to classify, never this parser's.
//
// The stream (probed against real git 2.43.0, git 2.38+'s own -z shape): <treeID>\0, then the
// CONFLICTED paths only (never every changed path — confirmed: a clean auto-merge's own paths
// section is empty even though it still carries an informational message below), each \0-
// terminated, the list ending with one extra empty \0 entry (so an empty list is just that lone
// terminator); then zero or more informational/conflict messages, each shaped
// <pathCount>\0<path1>\0...<pathN>\0<category>\0<message>\0 — message's own trailing "\n" kept
// verbatim, since its own text can itself span multiple real lines.
func ParseMergeTreeOutput(stdout []byte, exitCode int) (MergePrediction, error) {
	if exitCode != 0 && exitCode != 1 {
		return MergePrediction{}, fmt.Errorf("porcelain: merge-tree exited %d, not a clean/conflict result", exitCode)
	}
	fields := splitNULTerminated(stdout)
	if len(fields) == 0 {
		return MergePrediction{}, fmt.Errorf("porcelain: merge-tree produced no output")
	}
	treeID := fields[0]
	rest := fields[1:]

	var paths []string
	for len(rest) > 0 {
		if rest[0] == "" {
			rest = rest[1:]
			break
		}
		paths = append(paths, rest[0])
		rest = rest[1:]
	}
	if len(paths) > 0 && len(rest) == 0 {
		// The paths list never actually terminated (ran off the end of the stream without ever
		// hitting the empty marker entry) — a genuinely malformed/truncated stream, not silently
		// treated as "zero messages, that's all the paths there are".
		return MergePrediction{}, fmt.Errorf("porcelain: merge-tree path list never reached its terminator")
	}

	var messages []string
	for len(rest) > 0 {
		n, err := strconv.Atoi(rest[0])
		if err != nil || n < 0 {
			return MergePrediction{}, fmt.Errorf("porcelain: merge-tree message record has an invalid path count %q", rest[0])
		}
		need := 1 + n + 2 // the count field, n path fields, one category field, one message field.
		if len(rest) < need {
			return MergePrediction{}, fmt.Errorf("porcelain: merge-tree message record truncated (wanted %d fields, got %d)", need, len(rest))
		}
		messages = append(messages, rest[1+n+1])
		rest = rest[need:]
	}

	if exitCode == 0 {
		return MergePrediction{Kind: "clean", TreeID: treeID, Messages: messages}, nil
	}
	return MergePrediction{Kind: "conflicts", Paths: paths, Messages: messages}, nil
}
