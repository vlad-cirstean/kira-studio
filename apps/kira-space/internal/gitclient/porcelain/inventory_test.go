package porcelain_test

import (
	"bytes"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
)

// inventoryLine builds one InventoryFormat record's raw NUL-delimited bytes, LF-terminated —
// hand-built rather than a captured fixture: ParseInventory's own framing (splitNULRecords)
// needs no real git spawn to exercise, only the eight-field shape itself.
func inventoryLine(refname, tip, committerUnix, authorName, authorEmail, worktreePath, upstream, track string) []byte {
	fields := [][]byte{
		[]byte(refname), []byte(tip), []byte(committerUnix), []byte(authorName),
		[]byte(authorEmail), []byte(worktreePath), []byte(upstream), []byte(track),
	}
	return append(append(bytes.Join(fields, []byte{0}), 0), '\n')
}

func byShort(rows []porcelain.InventoryRef, short string) *porcelain.InventoryRef {
	for i := range rows {
		if rows[i].Short == short {
			return &rows[i]
		}
	}
	return nil
}

// TestParseInventory covers §3's own bullet list: upstream track variants (ahead/behind, [gone],
// no upstream), an empty worktree path (a remote-only review branch), and a multi-record NUL-framed
// stream — ParseInventory's own contract, not BranchInventory's (a thin git-backed pass-through with
// no logic of its own to test here, §9.1's own "no test for wrappers").
func TestParseInventory(t *testing.T) {
	t.Parallel()

	var raw []byte
	raw = append(raw, inventoryLine(
		"refs/heads/main", "aaa111", "1700000000", "Ada Lovelace", "ada@example.com",
		"/home/dev/repo", "refs/remotes/origin/main", "[ahead 2, behind 3]",
	)...)
	raw = append(raw, inventoryLine(
		"refs/heads/gonebranch", "bbb222", "1700000100", "Ada Lovelace", "ada@example.com",
		"", "refs/remotes/origin/gonebranch", "[gone]",
	)...)
	raw = append(raw, inventoryLine(
		"refs/heads/feature", "ccc333", "1700000200", "Ada Lovelace", "ada@example.com",
		"", "", "",
	)...)
	raw = append(raw, inventoryLine(
		"refs/remotes/origin/review-branch", "ddd444", "1700000300", "Grace Hopper", "grace@example.com",
		"", "", "",
	)...)

	rows, err := porcelain.ParseInventory(raw)
	if err != nil {
		t.Fatalf("ParseInventory: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4: %+v", len(rows), rows)
	}

	main := byShort(rows, "main")
	if main == nil {
		t.Fatal("no main row")
	}
	if main.Ref != "refs/heads/main" || main.Remote != "" {
		t.Fatalf("main = %+v", main)
	}
	if main.UpstreamAhead != 2 || main.UpstreamBehind != 3 || main.UpstreamGone {
		t.Fatalf("main upstream track = ahead:%d behind:%d gone:%v, want 2/3/false",
			main.UpstreamAhead, main.UpstreamBehind, main.UpstreamGone)
	}
	if main.WorktreePath != "/home/dev/repo" {
		t.Fatalf("main.WorktreePath = %q", main.WorktreePath)
	}
	if main.AuthorEmail != "ada@example.com" {
		t.Fatalf("main.AuthorEmail = %q", main.AuthorEmail)
	}

	gone := byShort(rows, "gonebranch")
	if gone == nil {
		t.Fatal("no gonebranch row")
	}
	if !gone.UpstreamGone || gone.UpstreamAhead != 0 || gone.UpstreamBehind != 0 {
		t.Fatalf("gonebranch track = %+v, want UpstreamGone=true, ahead/behind=0", gone)
	}

	feature := byShort(rows, "feature")
	if feature == nil {
		t.Fatal("no feature row")
	}
	if feature.Upstream != "" || feature.UpstreamGone || feature.UpstreamAhead != 0 || feature.UpstreamBehind != 0 {
		t.Fatalf("feature (no upstream at all) = %+v, want the all-zero/empty shape", feature)
	}
	if feature.WorktreePath != "" {
		t.Fatalf("feature.WorktreePath = %q, want empty (not checked out anywhere)", feature.WorktreePath)
	}

	review := byShort(rows, "review-branch")
	if review == nil {
		t.Fatal("no review-branch row")
	}
	if review.Ref != "refs/remotes/origin/review-branch" || review.Remote != "origin" {
		t.Fatalf("review-branch = %+v, want Remote=origin", review)
	}
	if review.AuthorName != "Grace Hopper" {
		t.Fatalf("review-branch.AuthorName = %q", review.AuthorName)
	}
}

func TestParseInventory_Empty(t *testing.T) {
	t.Parallel()
	rows, err := porcelain.ParseInventory(nil)
	if err != nil {
		t.Fatalf("ParseInventory(nil): %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("got %d rows, want 0", len(rows))
	}
}

func TestParseInventory_WrongFieldCount(t *testing.T) {
	t.Parallel()
	if _, err := porcelain.ParseInventory([]byte("refs/heads/main\x00aaa111\n")); err == nil {
		t.Fatal("expected an error for a record with too few fields")
	}
}

func TestParseInventory_WorktreePathWithNewline(t *testing.T) {
	t.Parallel()
	raw := append(inventoryLine("refs/heads/wt", "aaa111", "1", "A", "a@x", "/tmp/w\nx", "", ""),
		inventoryLine("refs/heads/main", "bbb222", "2", "A", "a@x", "", "", "")...)
	rows, err := porcelain.ParseInventory(raw)
	if err != nil {
		t.Fatalf("ParseInventory: %v", err)
	}
	if len(rows) != 2 || rows[0].WorktreePath != "/tmp/w\nx" || rows[1].Short != "main" {
		t.Fatalf("rows = %+v", rows)
	}
}
