package porcelain_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func byRefname(rows []porcelain.RefRow, refname string) *porcelain.RefRow {
	for i := range rows {
		if rows[i].Refname == refname {
			return &rows[i]
		}
	}
	return nil
}

// TestParseRefRows_Heads proves the LF-framed eleven-field record (D18): all three
// %(upstream:track) shapes, the trailing-empty-field case (a branch's own %(taggerdate:unix) is
// empty and last), isHead, and checkedOutIn for a branch checked out in a linked worktree.
func TestParseRefRows_Heads(t *testing.T) {
	rows, err := porcelain.ParseRefRows(readDiffFixture(t, "refs/heads.bin"), false)
	if err != nil {
		t.Fatalf("ParseRefRows: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4: %+v", len(rows), rows)
	}

	main := byRefname(rows, "refs/heads/main")
	if main == nil {
		t.Fatal("no refs/heads/main row")
	}
	if main.Kind != "branch" || main.ShortName != "main" {
		t.Fatalf("main = %+v", main)
	}
	if !main.IsHead {
		t.Fatal("main should be HEAD")
	}
	// %(worktreepath) is populated for the branch checked out in ANY worktree, including this
	// session's own (probe P2) — the "elsewhere" subtraction is gitsession's own job
	// (subtractOwnWorktree, D10), not this parser's, so the raw path is expected here.
	if main.CheckedOutIn == nil || *main.CheckedOutIn == "" {
		t.Fatal("main.CheckedOutIn should be populated (checked out in the main worktree)")
	}
	track, ok := main.Track.(porcelain.RefTrack)
	if !ok || track.Ahead != 1 || track.Behind != 0 {
		t.Fatalf("main.Track = %#v, want RefTrack{Ahead:1}", main.Track)
	}
	if main.Upstream == nil || *main.Upstream != "refs/remotes/origin/main" {
		t.Fatalf("main.Upstream = %v", main.Upstream)
	}

	gone := byRefname(rows, "refs/heads/gonebranch")
	if gone == nil {
		t.Fatal("no gonebranch row")
	}
	if s, ok := gone.Track.(string); !ok || s != "gone" {
		t.Fatalf("gonebranch.Track = %#v, want \"gone\"", gone.Track)
	}

	feature2 := byRefname(rows, "refs/heads/feature2")
	if feature2 == nil {
		t.Fatal("no feature2 row")
	}
	if feature2.Track != nil {
		t.Fatalf("feature2.Track = %#v, want nil (no upstream at all — the empty shape)", feature2.Track)
	}
	if feature2.CheckedOutIn == nil || *feature2.CheckedOutIn == "" {
		t.Fatal("feature2.CheckedOutIn should name the linked worktree's path")
	}
	if !strings.HasSuffix(*feature2.CheckedOutIn, "wt") {
		t.Fatalf("feature2.CheckedOutIn = %q, want it to end in the worktree dir", *feature2.CheckedOutIn)
	}
	// Every branch/remote-branch row's own trailing field (taggerdate:unix) is empty and last —
	// SplitLimitedFields must still return all 11 fields rather than silently dropping it.
	if feature2.Annotation != nil {
		t.Fatalf("feature2.Annotation = %+v, want nil (not a tag at all)", feature2.Annotation)
	}

	remote := byRefname(rows, "refs/remotes/origin/main")
	if remote == nil {
		t.Fatal("no refs/remotes/origin/main row")
	}
	if remote.Kind != "remoteBranch" || remote.ShortName != "origin/main" {
		t.Fatalf("remote = %+v", remote)
	}
}

// TestParseRefRows_Tags proves the NUL-framed thirteen-field record (D18/probe P1/P3): a
// lightweight tag's borrowed commit subject must be discarded, and an annotated tag's multi-line
// body must round-trip through the %00+\n framing intact.
func TestParseRefRows_Tags(t *testing.T) {
	rows, err := porcelain.ParseRefRows(readDiffFixture(t, "refs/tags.bin"), true)
	if err != nil {
		t.Fatalf("ParseRefRows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2: %+v", len(rows), rows)
	}

	light := byRefname(rows, "refs/tags/v-light")
	if light == nil {
		t.Fatal("no v-light row")
	}
	if light.Kind != "tag" || light.ShortName != "v-light" {
		t.Fatalf("v-light = %+v", light)
	}
	if light.Annotation != nil {
		t.Fatalf("v-light.Annotation = %+v, want nil — its %%(contents:subject) is the pointed-at "+
			"commit's own subject and must never be stored as this tag's annotation", light.Annotation)
	}
	if light.PeeledObjectID != nil {
		t.Fatalf("v-light.PeeledObjectID = %v, want nil (not annotated, nothing to peel)", light.PeeledObjectID)
	}

	ann := byRefname(rows, "refs/tags/v-ann")
	if ann == nil {
		t.Fatal("no v-ann row")
	}
	if ann.Annotation == nil {
		t.Fatal("v-ann.Annotation is nil, want the annotation")
	}
	if ann.Annotation.Tagger != "Kira Fixture" {
		t.Fatalf("tagger = %q", ann.Annotation.Tagger)
	}
	if ann.Annotation.Subject != "Annotated subject" {
		t.Fatalf("subject = %q", ann.Annotation.Subject)
	}
	if ann.Annotation.Body != "Body line one.\nBody line two.\n" {
		t.Fatalf("body = %q, want the raw-newline body to round-trip through NUL framing", ann.Annotation.Body)
	}
	if ann.PeeledObjectID == nil || *ann.PeeledObjectID == "" {
		t.Fatal("v-ann.PeeledObjectID should name the pointed-at commit")
	}
	if ann.ObjectID == *ann.PeeledObjectID {
		t.Fatal("v-ann.ObjectID (the TAG OBJECT's own sha) must differ from PeeledObjectID (the commit it points at)")
	}
}

func TestParseRefRows_EmptyInput(t *testing.T) {
	rows, err := porcelain.ParseRefRows(nil, false)
	if err != nil || len(rows) != 0 {
		t.Fatalf("ParseRefRows(nil, false) = %v, %v", rows, err)
	}
	rows, err = porcelain.ParseRefRows(nil, true)
	if err != nil || len(rows) != 0 {
		t.Fatalf("ParseRefRows(nil, true) = %v, %v", rows, err)
	}
}

// TestParseRefRows_NULFramingMalformed proves the %00+\n framing invariant is actually checked —
// a stream whose final split does not leave exactly "\n" is a malformed stream, not a silent skip.
func TestParseRefRows_NULFramingMalformed(t *testing.T) {
	raw := []byte("refs/tags/x\x1fsha\x1fcommit\x1f\x1f\x1f0\x1f \x1f\x1f\x1f\x1f\x1fsubj\x1fbody\x00")
	if _, err := porcelain.ParseRefRows(raw, true); err == nil {
		t.Fatal("expected an error for a stream missing its trailing \\n after the final NUL")
	}
}
