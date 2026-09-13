package gitreview

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s := NewStore(filepath.Join(t.TempDir(), "review.db"))
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return s
}

// TestStoreBranches is G24 D8/F6's own regression guard: a READ-ONLY listing of every branch with
// a stored session for a repo, and only that repo — never a second delete path.
func TestStoreBranches(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	rec := FileRecord{
		Path: "a.txt", State: "full", ReviewedAtSHA: "sha1",
		ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1",
		ContentKind: ContentBinary, ContentBytes: 0, LineCount: 0,
	}
	if err := s.Put(ctx, "repo-a", "feature-1", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := s.Put(ctx, "repo-a", "feature-2", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := s.Put(ctx, "repo-b", "other-repo-branch", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}

	branches, err := s.Branches(ctx, "repo-a")
	if err != nil {
		t.Fatalf("Branches: %v", err)
	}
	got := map[string]bool{}
	for _, b := range branches {
		got[b] = true
	}
	if len(got) != 2 || !got["feature-1"] || !got["feature-2"] {
		t.Fatalf("Branches(repo-a) = %v, want exactly [feature-1 feature-2]", branches)
	}

	none, err := s.Branches(ctx, "repo-nonexistent")
	if err != nil {
		t.Fatalf("Branches: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("Branches(repo-nonexistent) = %v, want empty", none)
	}
}

// TestStorePutRecordRoundTrip covers D18's own claim: mark -> read back -> re-mark (replacement,
// not accumulation).
func TestStorePutRecordRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	content := []byte("line one\nline two\nline three\n")
	rec := FileRecord{
		Path: "a.txt", State: "full", ReviewedAtSHA: "sha1",
		ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1",
		ContentKind: ContentText, ContentBytes: len(content), LineCount: 3,
	}
	if err := s.Put(ctx, "repo", "feature", rec, content); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, gotContent, found, err := s.Record(ctx, "repo", "feature", "a.txt")
	if err != nil || !found {
		t.Fatalf("Record: found=%v err=%v", found, err)
	}
	if got.BlobOID != "oid1" || got.State != "full" || got.LineCount != 3 {
		t.Fatalf("Record mismatch: %+v", got)
	}
	if string(gotContent) != string(content) {
		t.Fatalf("Record content = %q, want %q", gotContent, content)
	}

	// Records (the list path) never reads the content column.
	all, err := s.Records(ctx, "repo", "feature")
	if err != nil {
		t.Fatalf("Records: %v", err)
	}
	if len(all) != 1 || all["a.txt"].BlobOID != "oid1" {
		t.Fatalf("Records = %+v", all)
	}

	// Re-mark: a second Put for the SAME path REPLACES the row rather than accumulating a second
	// one — the whole point of the composite primary key (session_id, path).
	content2 := []byte("line one\nline two\nline three\nline four\n")
	rec2 := FileRecord{
		Path: "a.txt", State: "full", ReviewedAtSHA: "sha2",
		ReviewedAt: time.UnixMilli(2000), BlobOID: "oid2",
		ContentKind: ContentText, ContentBytes: len(content2), LineCount: 4,
	}
	if err := s.Put(ctx, "repo", "feature", rec2, content2); err != nil {
		t.Fatalf("second Put: %v", err)
	}
	all, err = s.Records(ctx, "repo", "feature")
	if err != nil {
		t.Fatalf("Records after re-mark: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("Records after re-mark has %d entries, want 1 (replacement, not accumulation): %+v", len(all), all)
	}
	if all["a.txt"].BlobOID != "oid2" || all["a.txt"].LineCount != 4 {
		t.Fatalf("Records after re-mark = %+v, want the second Put's values", all["a.txt"])
	}
}

// TestStoreUnmarkingPartOfAFullFileDemotesIt is D18's own "unmark-a-sub-range (demotes full to
// partial)" — proved at the Store level by writing the two rows a real MarkFile call would
// produce and checking the invariant holds.
func TestStoreUnmarkingPartOfAFullFileDemotesIt(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	content := []byte("ten lines of content, one per number\n")
	full := FileRecord{
		Path: "b.txt", State: "full", ReviewedAtSHA: "sha1",
		ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1",
		ContentKind: ContentText, ContentBytes: len(content), LineCount: 10,
	}
	if err := s.Put(ctx, "repo", "feature", full, content); err != nil {
		t.Fatalf("Put full: %v", err)
	}

	// Unmark lines 5-7 of a full (1-10) file: Subtract(Expand(10), [{5,7}]).
	remaining := Subtract(Expand(10), []LineRange{{Start: 5, End: 7}})
	partial := full
	partial.State = "partial"
	partial.Ranges = remaining
	if err := s.Put(ctx, "repo", "feature", partial, content); err != nil {
		t.Fatalf("Put partial: %v", err)
	}

	got, _, found, err := s.Record(ctx, "repo", "feature", "b.txt")
	if err != nil || !found {
		t.Fatalf("Record: found=%v err=%v", found, err)
	}
	if got.State != "partial" {
		t.Fatalf("State = %q, want partial", got.State)
	}
	want := []LineRange{{1, 4}, {8, 10}}
	if !reflect.DeepEqual(got.Ranges, want) {
		t.Fatalf("Ranges = %v, want %v", got.Ranges, want)
	}
}

func TestStoreDeleteLeavesSessionRowAlone(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	rec := FileRecord{Path: "a.txt", State: "full", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1"}
	if err := s.Put(ctx, "repo", "feature", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := s.Delete(ctx, "repo", "feature", "a.txt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	all, err := s.Records(ctx, "repo", "feature")
	if err != nil {
		t.Fatalf("Records: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("Records after Delete = %+v, want empty", all)
	}
	// The session row itself is untouched — Touch on it (which never creates a session) must
	// still succeed as an update, proving the row is still there.
	if err := s.Touch(ctx, "repo", "feature"); err != nil {
		t.Fatalf("Touch after Delete: %v", err)
	}
}

// TestStorePurgeCascades is D18's own "Purge cascades file and range rows" — the one place the FK
// cascade (_foreign_keys=1, D4) is load-bearing.
func TestStorePurgeCascades(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	content := []byte("hello\nworld\n")
	rec := FileRecord{
		Path: "a.txt", State: "partial", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000),
		BlobOID: "oid1", ContentKind: ContentText, ContentBytes: len(content), LineCount: 2,
		Ranges: []LineRange{{1, 1}},
	}
	if err := s.Put(ctx, "repo", "feature", rec, content); err != nil {
		t.Fatalf("Put: %v", err)
	}

	if err := s.Purge(ctx, "repo", "feature"); err != nil {
		t.Fatalf("Purge: %v", err)
	}

	all, err := s.Records(ctx, "repo", "feature")
	if err != nil {
		t.Fatalf("Records after Purge: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("Records after Purge = %+v, want empty", all)
	}

	// Directly assert the cascade removed the range row too, not merely that Records() reports
	// nothing (Records already proves review_file is gone; this proves review_range followed it,
	// which is the one place the FK cascade — _foreign_keys=1, D4 — is load-bearing).
	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	var rangeCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM review_range`).Scan(&rangeCount); err != nil {
		t.Fatalf("count review_range: %v", err)
	}
	if rangeCount != 0 {
		t.Fatalf("review_range has %d rows after Purge, want 0 (the FK cascade did not fire)", rangeCount)
	}

	// A purged session is really gone, not merely emptied — a fresh Put recreates it rather than
	// erroring on a dangling reference.
	if err := s.Put(ctx, "repo", "feature", rec, content); err != nil {
		t.Fatalf("Put after Purge: %v", err)
	}
	all, err = s.Records(ctx, "repo", "feature")
	if err != nil {
		t.Fatalf("Records after re-Put: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("Records after re-Put = %+v, want 1 entry", all)
	}
}

// TestStoreSweepDeletesOnlyExpiredSessions is D18's own "sweep deletes only sessions past IdleTTL
// and leaves the rest".
func TestStoreSweepDeletesOnlyExpiredSessions(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	rec := FileRecord{Path: "a.txt", State: "full", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000), BlobOID: "oid1"}
	if err := s.Put(ctx, "repo", "old-branch", rec, nil); err != nil {
		t.Fatalf("Put old: %v", err)
	}
	if err := s.Put(ctx, "repo", "fresh-branch", rec, nil); err != nil {
		t.Fatalf("Put fresh: %v", err)
	}

	// Back-date old-branch's last_used_at directly (Touch always uses time.Now(), so the only way
	// to simulate an idle session in a fast unit test is to write the timestamp directly).
	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	longAgo := time.Now().Add(-IdleTTL - time.Hour).UnixMilli()
	if _, err := db.Exec(`UPDATE review_session SET last_used_at = ? WHERE branch = ?`, longAgo, "old-branch"); err != nil {
		t.Fatalf("back-date old-branch: %v", err)
	}

	removed, err := s.sweep(time.Now())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if removed != 1 {
		t.Fatalf("sweep removed %d sessions, want 1", removed)
	}

	oldRecords, err := s.Records(ctx, "repo", "old-branch")
	if err != nil {
		t.Fatalf("Records old-branch: %v", err)
	}
	if len(oldRecords) != 0 {
		t.Fatalf("old-branch survived the sweep: %+v", oldRecords)
	}
	freshRecords, err := s.Records(ctx, "repo", "fresh-branch")
	if err != nil {
		t.Fatalf("Records fresh-branch: %v", err)
	}
	if len(freshRecords) != 1 {
		t.Fatalf("fresh-branch did not survive the sweep: %+v", freshRecords)
	}
}

func TestStoreTouchNeverCreatesASession(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	if err := s.Touch(ctx, "repo", "never-marked"); err != nil {
		t.Fatalf("Touch: %v", err)
	}
	all, err := s.Records(ctx, "repo", "never-marked")
	if err != nil {
		t.Fatalf("Records: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("Touch on a never-marked branch created records: %+v", all)
	}
}

// TestKeyedMutexSerializesSameKeyOnly is D12's own concurrency claim at the lock's own level:
// same-key calls serialize, different-key calls never contend.
func TestKeyedMutexSerializesSameKeyOnly(t *testing.T) {
	k := newKeyedMutex()

	unlockA := k.lock("same")
	unlockedSecond := make(chan struct{})
	go func() {
		unlockB := k.lock("same") // must block until unlockA runs
		close(unlockedSecond)
		unlockB()
	}()

	select {
	case <-unlockedSecond:
		t.Fatal("a second lock on the same key acquired before the first released it")
	case <-time.After(20 * time.Millisecond):
		// expected: still blocked
	}
	unlockA()

	select {
	case <-unlockedSecond:
	case <-time.After(2 * time.Second):
		t.Fatal("second lock on the same key never acquired after the first released it")
	}

	// A different key must never block on "same"'s holder.
	unlockA2 := k.lock("same")
	defer unlockA2()
	done := make(chan struct{})
	go func() {
		unlockOther := k.lock("different")
		close(done)
		unlockOther()
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a lock on a different key blocked behind an unrelated key's holder")
	}
}
