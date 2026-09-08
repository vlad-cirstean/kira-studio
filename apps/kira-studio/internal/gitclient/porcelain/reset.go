package porcelain

import (
	"fmt"
	"strconv"
	"strings"
)

// ResetLeavingCommitsCap is ResetPreflight.leavingCommits' own display cap — upstream's own 10
// (repoService.ts:472). The list read below fetches cap+1 so `leavingTruncated` needs no second
// count spawn.
const ResetLeavingCommitsCap = 10

// RangeCommit is one entry of ResetPreflight.leavingCommits — a plain {sha, subject} pair, JSON
// tagged to match the wire shape verbatim.
type RangeCommit struct {
	Sha     string `json:"sha"`
	Subject string `json:"subject"`
}

// LeftRightCountArgs is `rev-list --count --left-right <a>...<b>` (probe 4). THREE dots, not two:
// RangeToken's own two-dot token answers only "what leaves"; a reset target can diverge from HEAD
// in both directions and the dialog reports both. Deliberately not routed through RangeToken,
// whose doc comment states it exists so "no call site can drift to three-dot" — this is the one
// call that genuinely wants three, and says so here rather than weakening that guarantee.
func LeftRightCountArgs(a, b string) []string {
	return []string{"rev-list", "--count", "--left-right", a + "..." + b}
}

// ParseLeftRightCount parses the single "<left>\t<right>" line rev-list --left-right emits. Left
// is only-reachable-from `a` (what a reset to `a` would GAIN); right is only-reachable-from `b`
// (what it would LEAVE).
func ParseLeftRightCount(stdout []byte) (left, right int, err error) {
	line := strings.TrimSpace(string(stdout))
	parts := strings.Split(line, "\t")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("porcelain: left-right count %q has %d fields, want 2", line, len(parts))
	}
	left, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("porcelain: left-right count: left: %w", err)
	}
	right, err = strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("porcelain: left-right count: right: %w", err)
	}
	return left, right, nil
}

// RangeSubjectsArgs is `log --format=%H%x1f%s -z -<cap+1> <base>..<tip>`. Deliberately `log`, not
// the plan's literally-named `rev-list`: upstream verified empirically that `rev-list --format=…
// -z` prepends a `commit <sha>` line and ignores -z for record separation, while `log --format=…
// -z` gives clean NUL-delimited two-field records (queries.ts:281-286) — the same convention
// StashBaseSubjectArgs already follows here.
func RangeSubjectsArgs(base, tip string, cap int) []string {
	return []string{"log", "--format=%H%x1f%s", "-z", fmt.Sprintf("-%d", cap+1), base + ".." + tip}
}

// ParseRangeSubjects frames raw through RecordSplitter and returns the first cap records plus
// whether more than cap came back.
func ParseRangeSubjects(raw []byte, cap int) (commits []RangeCommit, truncated bool, err error) {
	splitter := NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, false, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, false, fmt.Errorf("porcelain: range subjects: unterminated trailing bytes: %q", flushed)
	}
	// A trailing empty record (the final `-z`'s own terminator) must never count as a real commit —
	// the same filter listRange's own `.filter((r) => r.length > 0)` applies upstream.
	var nonEmpty [][]byte
	for _, r := range recs {
		if len(r) > 0 {
			nonEmpty = append(nonEmpty, r)
		}
	}

	limit := len(nonEmpty)
	if limit > cap {
		limit = cap
	}
	commits = make([]RangeCommit, 0, limit)
	for _, rec := range nonEmpty[:limit] {
		fields := SplitLimitedFields(rec, fieldDelim, 2)
		if len(fields) != 2 {
			return nil, false, fmt.Errorf("porcelain: range subjects: record %q has %d fields, want 2", rec, len(fields))
		}
		commits = append(commits, RangeCommit{Sha: string(fields[0]), Subject: string(fields[1])})
	}
	return commits, len(nonEmpty) > cap, nil
}
