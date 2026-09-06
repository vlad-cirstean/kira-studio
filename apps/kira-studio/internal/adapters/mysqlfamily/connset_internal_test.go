package mysqlfamily

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// White-box (package mysqlfamily) coverage for ConnSet.Acquire's per-connection lock — P21 round 2
// performance finding 3. A real dial (get()'s BuildConfig -> mysql.NewConnector -> db.Conn) needs a
// live server, so these tests pre-populate ConnSet.conns directly with a fake connEntry to reach
// get()'s cache-hit branch (the same key/lookup path a real, already-open connection takes) without
// ever touching the network — the lock semantics under test live entirely in Acquire/get, not in
// how the entry was first opened. *sql.Conn is never dereferenced by these tests (no query is ever
// run on it), so a nil one is a faithful enough stand-in for "some already-open connection".

func connSetWithFakeEntry(key string) *ConnSet {
	s := &ConnSet{conns: make(map[string]*connEntry)}
	s.conns[key] = &connEntry{conn: (*sql.Conn)(nil), threadID: 42}
	return s
}

// TestAcquireSerializesTwoCallersOnTheSameConnection is the finding's own regression: before this
// fix, ConnSet.Get handed back a bare *sql.Conn with no lock at all — two concurrent callers (two
// data tabs on the same database, or a Read racing a console Execute) could run statements on the
// same pinned, non-shareable connection at the same time. Acquire must now serialize them: the
// second caller's Acquire must not return until the first caller's release() runs.
func TestAcquireSerializesTwoCallersOnTheSameConnection(t *testing.T) {
	s := connSetWithFakeEntry(primaryKey)
	ctx := context.Background()

	_, release1, err := s.Acquire(ctx, "")
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}

	secondAcquired := make(chan struct{})
	go func() {
		_, release2, err := s.Acquire(ctx, "")
		if err != nil {
			t.Errorf("second Acquire: %v", err)
			close(secondAcquired)
			return
		}
		close(secondAcquired)
		release2()
	}()

	select {
	case <-secondAcquired:
		t.Fatal("second Acquire returned before the first caller's release() ran — the two callers were not serialized")
	case <-time.After(50 * time.Millisecond):
		// Expected: the second Acquire is still blocked on the entry's own lock.
	}

	release1()

	select {
	case <-secondAcquired:
		// The second Acquire unblocked once the first released, as it must.
	case <-time.After(1 * time.Second):
		t.Fatal("second Acquire never unblocked after the first caller's release()")
	}
}

// TestAcquireOnDifferentDatabasesDoesNotSerialize confirms the fix is a per-connection lock, not
// an accidental whole-ConnSet lock: two callers acquiring *different* databases' connections must
// not block each other at all.
func TestAcquireOnDifferentDatabasesDoesNotSerialize(t *testing.T) {
	s := connSetWithFakeEntry(primaryKey)
	s.conns["dbtwo"] = &connEntry{conn: (*sql.Conn)(nil), threadID: 43}
	ctx := context.Background()

	_, release1, err := s.Acquire(ctx, "")
	if err != nil {
		t.Fatalf("Acquire(primary): %v", err)
	}
	defer release1()

	done := make(chan struct{})
	go func() {
		_, release2, err := s.Acquire(ctx, "dbtwo")
		if err != nil {
			t.Errorf("Acquire(dbtwo): %v", err)
		} else {
			release2()
		}
		close(done)
	}()

	select {
	case <-done:
		// Expected: a different database's entry acquires immediately.
	case <-time.After(1 * time.Second):
		t.Fatal("Acquire on a different database blocked behind an unrelated connection's lock")
	}
}
