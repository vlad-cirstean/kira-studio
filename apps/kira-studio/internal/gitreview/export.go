package gitreview

import (
	"fmt"
	"sort"
	"strings"
)

// CommentAnchor is how a stored comment's line range relates to the revision it was asked about
// (D7) — reported alongside every projected range so a reader (and the export) can tell "current"
// from "here is where these numbers came from".
type CommentAnchor string

const (
	// AnchorExact: the file is byte-identical to when the comment was written.
	AnchorExact CommentAnchor = "exact"
	// AnchorProjected: the lines moved and were mapped forward through a real diff.
	AnchorProjected CommentAnchor = "projected"
	// AnchorRemoved: the commented lines no longer exist; Range is as of AnchorSHA.
	AnchorRemoved CommentAnchor = "removed"
	// AnchorStale: history was rewritten and no mapping exists; Range is as of AnchorSHA.
	AnchorStale CommentAnchor = "stale"
)

// AnchoredComment is one stored Comment plus D7's anchor resolution against a requested revision.
type AnchoredComment struct {
	Comment
	Anchor CommentAnchor
	Range  LineRange // projected onto the requested revision, or the stored range for removed/stale
}

// SortAnchored applies D13's total order in place: path (byte order), then the reported Range's
// start and end (the narrower comment first), then CreatedAt, then ID as the final tiebreak — two
// comments can share a millisecond, so ID is what makes the order total. review.comment.list and
// the export share this one ordering rather than each computing their own.
func SortAnchored(cs []AnchoredComment) {
	sort.Slice(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Range.Start != b.Range.Start {
			return a.Range.Start < b.Range.Start
		}
		if a.Range.End != b.Range.End {
			return a.Range.End < b.Range.End
		}
		if !a.CreatedAt.Equal(b.CreatedAt) {
			return a.CreatedAt.Before(b.CreatedAt)
		}
		return a.ID < b.ID
	})
}

// sha8 is the anchor line's own cosmetic shorthand — the full sha is on review.comment.list for
// anything that needs it (D12).
func sha8(sha string) string {
	if len(sha) <= 8 {
		return sha
	}
	return sha[:8]
}

// FormatComments renders D12's exact AI-paste text: a header line naming branch and the comment
// count, then one entry per comment (an anchor line, the body, a blank line), ending in exactly
// one trailing newline. "" for an empty session (rule 9: cs must already be SortAnchored'd — this
// function renders, it does not sort).
func FormatComments(branch string, cs []AnchoredComment) string {
	if len(cs) == 0 {
		return ""
	}

	noun := "comments"
	if len(cs) == 1 {
		noun = "comment"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Review comments — %s (%d %s)\n\n", branch, len(cs), noun)

	for i, c := range cs {
		if c.Range.Start == c.Range.End {
			fmt.Fprintf(&b, "%s:%d", c.Path, c.Range.Start)
		} else {
			fmt.Fprintf(&b, "%s:%d-%d", c.Path, c.Range.Start, c.Range.End)
		}
		switch c.Anchor {
		case AnchorRemoved:
			fmt.Fprintf(&b, "  [these lines no longer exist on %s; shown as of %s]", branch, sha8(c.AnchorSHA))
		case AnchorStale:
			fmt.Fprintf(&b, "  [lines as of %s; %s's history was rewritten since]", sha8(c.AnchorSHA), branch)
		}
		b.WriteByte('\n')

		for _, line := range strings.Split(c.Body, "\n") {
			b.WriteString(strings.TrimRight("  "+line, " \t"))
			b.WriteByte('\n')
		}
		if i != len(cs)-1 {
			b.WriteByte('\n')
		}
	}
	return b.String()
}
