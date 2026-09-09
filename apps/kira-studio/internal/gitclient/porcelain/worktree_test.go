package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// nul joins parts with a trailing NUL after each, matching git's own `-z` framing for
// `worktree list --porcelain` byte-for-byte (probe P1).
func nul(parts ...string) []byte {
	var b []byte
	for _, p := range parts {
		b = append(b, p...)
		b = append(b, 0)
	}
	return b
}

// TestParseWorktreeList_Golden is probe P1's own golden bytes — main plus one linked worktree, byte
// for byte as observed against real git 2.43.0: `worktree <path>\0HEAD <sha>\0branch <ref>\0\0`
// repeated, with no trailing content beyond the stream's own closing double-NUL.
func TestParseWorktreeList_Golden(t *testing.T) {
	raw := nul(
		"worktree /repo", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main", "",
		"worktree /repo-wt", "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "branch refs/heads/feature", "",
	)
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil {
		t.Fatalf("ParseWorktreeList: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2: %+v", len(records), records)
	}
	if records[0].Path != "/repo" || records[0].Head != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || records[0].Branch != "refs/heads/main" {
		t.Fatalf("record 0 = %+v", records[0])
	}
	if records[1].Path != "/repo-wt" || records[1].Branch != "refs/heads/feature" {
		t.Fatalf("record 1 = %+v", records[1])
	}
	for i, r := range records {
		if r.Locked || r.Prunable || r.Bare || r.Detached {
			t.Fatalf("record %d has an unexpected flag set: %+v", i, r)
		}
	}
}

// TestParseWorktreeList_LockedAndPrunable is M5/M7's own observed shape: `locked <reason>` and
// `prunable <reason>` attribute lines, each carrying free text (git's own lock reason / prune
// diagnosis) that must survive through unmodified.
func TestParseWorktreeList_LockedAndPrunable(t *testing.T) {
	raw := nul(
		"worktree /repo", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main", "",
		"worktree /repo-locked", "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "branch refs/heads/m5branch",
		"locked testing lock reason", "",
		"worktree /repo-prunable", "HEAD cccccccccccccccccccccccccccccccccccccccc", "branch refs/heads/m7branch",
		"prunable gitdir file points to non-existent location", "",
	)
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil {
		t.Fatalf("ParseWorktreeList: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("got %d records, want 3: %+v", len(records), records)
	}
	locked := records[1]
	if !locked.Locked || locked.LockedReason != "testing lock reason" {
		t.Fatalf("locked record = %+v", locked)
	}
	prunable := records[2]
	if !prunable.Prunable || prunable.PrunableReason != "gitdir file points to non-existent location" {
		t.Fatalf("prunable record = %+v", prunable)
	}
}

// TestParseWorktreeList_DetachedAndBare covers the two boolean-only attributes — no trailing value,
// no "branch" line at all for either.
func TestParseWorktreeList_DetachedAndBare(t *testing.T) {
	raw := nul(
		"worktree /repo.git", "bare", "",
		"worktree /repo-detached", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "detached", "",
	)
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil {
		t.Fatalf("ParseWorktreeList: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2: %+v", len(records), records)
	}
	if !records[0].Bare || records[0].Branch != "" {
		t.Fatalf("bare record = %+v", records[0])
	}
	if !records[1].Detached || records[1].Branch != "" {
		t.Fatalf("detached record = %+v", records[1])
	}
}

// TestParseWorktreeList_NewlineInPath: a record's path attribute is one NUL-terminated token, so a
// literal newline byte inside a path (legal on Linux/macOS filesystems) must pass straight through
// rather than being treated as any kind of separator — this parser never splits on '\n' at all.
func TestParseWorktreeList_NewlineInPath(t *testing.T) {
	raw := nul(
		"worktree /repo/weird\npath", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main", "",
	)
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil {
		t.Fatalf("ParseWorktreeList: %v", err)
	}
	if len(records) != 1 || records[0].Path != "/repo/weird\npath" {
		t.Fatalf("records = %+v", records)
	}
}

// TestParseWorktreeList_UnknownAttributeIgnored: a future git version's own new attribute line must
// never abort parsing or be misfiled onto an adjacent field (D1's own WorktreeEntry doc comment).
func TestParseWorktreeList_UnknownAttributeIgnored(t *testing.T) {
	raw := nul(
		"worktree /repo", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main",
		"some-future-attribute value nobody expects yet", "",
	)
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil {
		t.Fatalf("ParseWorktreeList: %v", err)
	}
	if len(records) != 1 || records[0].Path != "/repo" || records[0].Branch != "refs/heads/main" {
		t.Fatalf("records = %+v", records)
	}
}

// TestParseWorktreeList_TruncatedInput: a process killed mid-write (or a genuinely empty
// repository with no worktrees at all — impossible in practice, but not this parser's job to
// assume) must not panic; a record with no trailing double-NUL is still flushed once at end of
// input, since ParseWorktreeList consumes a complete already-read buffer, never a streaming one.
func TestParseWorktreeList_TruncatedInput(t *testing.T) {
	if records, err := porcelain.ParseWorktreeList(nil); err != nil || len(records) != 0 {
		t.Fatalf("empty input: records=%+v err=%v", records, err)
	}
	// A single record with its closing NUL present but nothing after it.
	raw := nul("worktree /repo", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main", "")
	records, err := porcelain.ParseWorktreeList(raw)
	if err != nil || len(records) != 1 {
		t.Fatalf("records=%+v err=%v", records, err)
	}
	// A record missing its closing double-NUL (process killed after the last attribute's own single
	// NUL) — still flushed as one complete record, not silently dropped.
	truncated := nul("worktree /repo", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/main")
	records, err = porcelain.ParseWorktreeList(truncated)
	if err != nil || len(records) != 1 || records[0].Path != "/repo" {
		t.Fatalf("records=%+v err=%v", records, err)
	}
}
