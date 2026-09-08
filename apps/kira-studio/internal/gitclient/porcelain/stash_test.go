package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func TestStashListArgs(t *testing.T) {
	got := porcelain.StashListArgs()
	want := []string{"stash", "list", "-z", "--numstat", "-M", "-C", "--format=" + porcelain.StashFormat}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestStashShowArgs(t *testing.T) {
	numstat, nameStatus := porcelain.StashShowArgs("base123", "stash456")
	wantNumstat := porcelain.NumstatArgs(strPtr("base123"), "stash456")
	wantNameStatus := porcelain.NameStatusArgs(strPtr("base123"), "stash456")
	if len(numstat) != len(wantNumstat) || len(nameStatus) != len(wantNameStatus) {
		t.Fatalf("got %v / %v, want %v / %v", numstat, nameStatus, wantNumstat, wantNameStatus)
	}
	for i := range wantNumstat {
		if numstat[i] != wantNumstat[i] {
			t.Fatalf("numstat got %v, want %v", numstat, wantNumstat)
		}
	}
	for i := range wantNameStatus {
		if nameStatus[i] != wantNameStatus[i] {
			t.Fatalf("nameStatus got %v, want %v", nameStatus, wantNameStatus)
		}
	}
}

func TestStashUntrackedLsTreeArgs(t *testing.T) {
	got := porcelain.StashUntrackedLsTreeArgs("abc123")
	want := []string{"ls-tree", "-r", "--name-only", "-z", "abc123"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// TestParseStashList_TwoEntry covers a two-entry stack: stash@{0} (pushed last, no -u, one tracked
// file) and stash@{1} (pushed first, -u, one tracked file plus an untracked parent) — the "zero or
// more numstat records, first one carrying a leading \n" framing (probe 12), the three-vs-two
// parent split (indexSha always present, untrackedSha iff -u), and baseSubject's own batch-resolved
// join, all against real git 2.43 output.
func TestParseStashList_TwoEntry(t *testing.T) {
	raw := readDiffFixture(t, "stash/twoEntry.list.bin")
	subjRaw := readDiffFixture(t, "stash/twoEntry.subjects.bin")
	subjects, err := porcelain.ParseStashBaseSubjects(subjRaw)
	if err != nil {
		t.Fatalf("ParseStashBaseSubjects: %v", err)
	}

	entries, err := porcelain.ParseStashList(raw, subjects)
	if err != nil {
		t.Fatalf("ParseStashList: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2: %+v", len(entries), entries)
	}

	top := entries[0]
	if top.Index != 0 {
		t.Fatalf("top.Index = %d, want 0", top.Index)
	}
	if top.Message != "On main: second stash" {
		t.Fatalf("top.Message = %q", top.Message)
	}
	if top.Branch == nil || *top.Branch != "main" {
		t.Fatalf("top.Branch = %v, want \"main\"", top.Branch)
	}
	if top.FileCount != 1 {
		t.Fatalf("top.FileCount = %d, want 1", top.FileCount)
	}
	if top.UntrackedSha != nil {
		t.Fatalf("top.UntrackedSha = %v, want nil (pushed without -u)", top.UntrackedSha)
	}
	if top.IncludedUntracked {
		t.Fatal("top.IncludedUntracked = true, want false")
	}
	if top.IndexSha == "" {
		t.Fatal("top.IndexSha is empty, want the index tree commit's own sha")
	}
	if top.BaseSubject != "second commit" {
		t.Fatalf("top.BaseSubject = %q, want %q", top.BaseSubject, "second commit")
	}

	bottom := entries[1]
	if bottom.Index != 1 {
		t.Fatalf("bottom.Index = %d, want 1", bottom.Index)
	}
	if bottom.Message != "On main: first stash" {
		t.Fatalf("bottom.Message = %q", bottom.Message)
	}
	if bottom.UntrackedSha == nil {
		t.Fatal("bottom.UntrackedSha is nil, want the untracked helper commit's own sha (pushed with -u)")
	}
	if !bottom.IncludedUntracked {
		t.Fatal("bottom.IncludedUntracked = false, want true")
	}
	if bottom.FileCount != 1 {
		t.Fatalf("bottom.FileCount = %d, want 1 (tracked file count only — probe 12: -u never counts here)", bottom.FileCount)
	}
	// Both entries share the same baseSha — both were pushed after the same two commits landed, no
	// commit in between.
	if top.BaseSha != bottom.BaseSha {
		t.Fatalf("top.BaseSha %q != bottom.BaseSha %q", top.BaseSha, bottom.BaseSha)
	}
	if bottom.BaseSubject != "second commit" {
		t.Fatalf("bottom.BaseSubject = %q, want %q", bottom.BaseSubject, "second commit")
	}
}

// TestParseStashList_StoreRestored covers probe 9: a `stash store`-restored entry's own message
// carries neither the "WIP on "/"On " prefix — Branch must resolve to nil rather than panicking or
// guessing.
func TestParseStashList_StoreRestored(t *testing.T) {
	raw := readDiffFixture(t, "stash/storeRestored.bin")
	entries, err := porcelain.ParseStashList(raw, nil)
	if err != nil {
		t.Fatalf("ParseStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	entry := entries[0]
	if entry.Message != "custom restore message, no WIP/On prefix" {
		t.Fatalf("Message = %q", entry.Message)
	}
	if entry.Branch != nil {
		t.Fatalf("Branch = %v, want nil (no WIP on/On prefix at all)", entry.Branch)
	}
	// A nil subjects map must not panic — every baseSubject resolves to "".
	if entry.BaseSubject != "" {
		t.Fatalf("BaseSubject = %q, want \"\" (subjects map was nil)", entry.BaseSubject)
	}
}

// TestParseStashList_Detached covers a stash pushed from a detached HEAD — message
// "On (no branch): …" (confirmed against real git 2.43) — Branch must resolve to nil, not the
// literal string "(no branch)".
func TestParseStashList_Detached(t *testing.T) {
	raw := readDiffFixture(t, "stash/detached.bin")
	entries, err := porcelain.ParseStashList(raw, nil)
	if err != nil {
		t.Fatalf("ParseStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	entry := entries[0]
	if entry.Message != "On (no branch): detached test" {
		t.Fatalf("Message = %q", entry.Message)
	}
	if entry.Branch != nil {
		t.Fatalf("Branch = %v, want nil for a detached-HEAD stash", entry.Branch)
	}
}

func TestParseStashList_MalformedHeader(t *testing.T) {
	if _, err := porcelain.ParseStashList([]byte("not-a-header\x00"), nil); err == nil {
		t.Fatal("expected an error for a record set not starting with a stash@{ header")
	}
}
