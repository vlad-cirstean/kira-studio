package porcelain_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

const testGlobalStashRefPrefix = "refs/kira/globalstash/"

func hex(c byte) string { return strings.Repeat(string(c), 40) }

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

func TestGlobalStashLogArgs(t *testing.T) {
	got := porcelain.GlobalStashLogArgs([]string{"sha1", "sha2"})
	want := []string{
		"log", "--no-walk", "-m", "--first-parent", "-z", "--numstat", "-M", "-C",
		"--format=" + porcelain.GlobalStashFormat, "sha1", "sha2",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestGlobalStashFormat_FieldCountMatchesStashFormat(t *testing.T) {
	if got, want := strings.Count(porcelain.GlobalStashFormat, "\x1f"), strings.Count(porcelain.StashFormat, "\x1f"); got != want {
		t.Fatalf("GlobalStashFormat has %d field delimiters, want %d (must match StashFormat's field count so parseStashRecords applies unchanged)", got, want)
	}
}

// TestParseGlobalStashList_TwoParent covers a tracked-only global entry (no -u): 2 parents,
// Scope=global, Index=-1 (D17's sentinel), Ref built from the caller-supplied refPrefix.
func TestParseGlobalStashList_TwoParent(t *testing.T) {
	sha := hex('a')
	base := hex('b')
	indexSha := hex('c')
	raw := []byte(sha + "\x1f" + sha + "\x1f" + base + " " + indexSha + "\x1f" + "On main: my label" + "\x1f" + "1690000000\x00" +
		"\n1\t1\tfile.txt\x00")

	entries, err := porcelain.ParseGlobalStashList(raw, nil, testGlobalStashRefPrefix)
	if err != nil {
		t.Fatalf("ParseGlobalStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1: %+v", len(entries), entries)
	}
	e := entries[0]
	if e.Index != -1 {
		t.Fatalf("Index = %d, want -1 (D17 sentinel)", e.Index)
	}
	if e.Scope != porcelain.StashScopeGlobal {
		t.Fatalf("Scope = %q, want %q", e.Scope, porcelain.StashScopeGlobal)
	}
	if e.Ref != testGlobalStashRefPrefix+sha {
		t.Fatalf("Ref = %q, want %q", e.Ref, testGlobalStashRefPrefix+sha)
	}
	if e.Sha != sha || e.BaseSha != base || e.IndexSha != indexSha {
		t.Fatalf("sha/base/index = %q/%q/%q", e.Sha, e.BaseSha, e.IndexSha)
	}
	if e.UntrackedSha != nil || e.IncludedUntracked {
		t.Fatalf("entry pushed without -u must have no untracked half: %+v", e)
	}
	if e.Message != "On main: my label" {
		t.Fatalf("Message = %q", e.Message)
	}
	if e.Branch == nil || *e.Branch != "main" {
		t.Fatalf("Branch = %v, want \"main\"", e.Branch)
	}
	if e.FileCount != 1 {
		t.Fatalf("FileCount = %d, want 1", e.FileCount)
	}
}

// TestParseGlobalStashList_ThreeParentUntrackedZeroNumstat covers an untracked-only global entry
// (-u, no tracked changes at all): 3 parents, IncludedUntracked=true, zero numstat records — the
// same "zero or more numstat records" framing ParseStashList's own untracked-only case already
// covers, now proven for the bucket's own header shape too.
func TestParseGlobalStashList_ThreeParentUntrackedZeroNumstat(t *testing.T) {
	sha := hex('1')
	base := hex('2')
	indexSha := hex('3')
	untrackedSha := hex('4')
	raw := []byte(sha + "\x1f" + sha + "\x1f" + base + " " + indexSha + " " + untrackedSha + "\x1f" +
		"On feature: untracked only" + "\x1f" + "1690000001\x00")

	entries, err := porcelain.ParseGlobalStashList(raw, nil, testGlobalStashRefPrefix)
	if err != nil {
		t.Fatalf("ParseGlobalStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1: %+v", len(entries), entries)
	}
	e := entries[0]
	if e.UntrackedSha == nil || *e.UntrackedSha != untrackedSha {
		t.Fatalf("UntrackedSha = %v, want %q", e.UntrackedSha, untrackedSha)
	}
	if !e.IncludedUntracked {
		t.Fatal("IncludedUntracked = false, want true (3 parents)")
	}
	if e.FileCount != 0 {
		t.Fatalf("FileCount = %d, want 0 (no tracked numstat records at all)", e.FileCount)
	}
}

// TestParseGlobalStashList_TwoEntryHeaderShapedPathNeverMisdetected proves isGlobalStashHeader's
// own "unambiguous against a numstat record" claim directly: the first entry's own numstat record
// names a file whose basename is itself 40 hex characters — a pathological near-miss for "looks
// like a header" — and it must still be folded into entry one's own numstat, never mistaken for a
// third entry's header.
func TestParseGlobalStashList_TwoEntryHeaderShapedPathNeverMisdetected(t *testing.T) {
	sha1 := hex('a')
	base := hex('b')
	indexSha := hex('c')
	pathologicalPath := hex('d') // a file NAME that happens to be 40 hex characters
	sha2 := hex('e')

	raw := []byte(
		sha1 + "\x1f" + sha1 + "\x1f" + base + " " + indexSha + "\x1f" + "On main: one" + "\x1f" + "1690000000\x00" +
			"\n1\t1\t" + pathologicalPath + "\x00" +
			sha2 + "\x1f" + sha2 + "\x1f" + base + "\x1f" + "On main: two" + "\x1f" + "1690000001\x00",
	)

	entries, err := porcelain.ParseGlobalStashList(raw, nil, testGlobalStashRefPrefix)
	if err != nil {
		t.Fatalf("ParseGlobalStashList: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2 (the pathological numstat path must not be misdetected as a third header): %+v", len(entries), entries)
	}
	if entries[0].Sha != sha1 || entries[0].FileCount != 1 {
		t.Fatalf("entries[0] = %+v, want sha %q with FileCount 1", entries[0], sha1)
	}
	if entries[1].Sha != sha2 || entries[1].FileCount != 0 {
		t.Fatalf("entries[1] = %+v, want sha %q with FileCount 0", entries[1], sha2)
	}
}

func TestParseGlobalStashList_MalformedHeaderNot40Hex(t *testing.T) {
	if _, err := porcelain.ParseGlobalStashList([]byte("not-a-sha\x00"), nil, testGlobalStashRefPrefix); err == nil {
		t.Fatal("expected an error for a record set not starting with a 40-hex header")
	}
}
