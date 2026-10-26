package gitsession

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

func at(updatedMs ...int64) []githost.ChangeRequest {
	out := make([]githost.ChangeRequest, len(updatedMs))
	for i, u := range updatedMs {
		out[i] = githost.ChangeRequest{Number: i + 1, UpdatedAt: u}
	}
	return out
}

func TestDeltaStop(t *testing.T) {
	const wm = int64(1_000_000)
	skew := 2 * time.Minute
	cutoff := wm - skew.Milliseconds()
	cases := []struct {
		name     string
		items    []githost.ChangeRequest
		wantKeep int
		wantDone bool
	}{
		{"watermark inside the page", at(wm+5000, wm, cutoff-1, cutoff-5), 2, true},
		{"exactly at watermark minus skew is kept", at(wm, cutoff), 2, false},
		{"all newer continues", at(wm+3, wm+2, wm+1), 3, false},
		{"first already older", at(cutoff-1, cutoff-2), 0, true},
		{"ties around the boundary", at(cutoff, cutoff, cutoff-1, cutoff-1), 2, true},
		{"empty page", nil, 0, false},
	}
	for _, c := range cases {
		keep, done := deltaStop(c.items, wm, skew)
		if keep != c.wantKeep || done != c.wantDone {
			t.Errorf("%s: deltaStop = (%d, %v), want (%d, %v)", c.name, keep, done, c.wantKeep, c.wantDone)
		}
	}
}

// A walk that hits the page cap before an older item must report unreached, so the run falls back
// to a resumable backfill from where it stopped.
func TestWalkDeltaPageCap(t *testing.T) {
	newer := func(cursor string) (githost.ChangeRequestPage, githost.Status) {
		n, _ := strconv.Atoi(cursor)
		return githost.ChangeRequestPage{Items: at(9_000_000), EndCursor: strconv.Itoa(n + 1), HasNext: true},
			githost.Status{Kind: githost.KindOK}
	}
	w := walkDelta(newer, 1_000_000, time.Minute, 3)
	if w.reached || w.cursor != "3" || len(w.items) != 3 || !w.status.OK() {
		t.Fatalf("walk = %+v, want unreached at cursor 3 with 3 items", w)
	}

	older := func(cursor string) (githost.ChangeRequestPage, githost.Status) {
		if cursor == "" {
			return githost.ChangeRequestPage{Items: at(9_000_000), EndCursor: "1", HasNext: true}, githost.Status{Kind: githost.KindOK}
		}
		return githost.ChangeRequestPage{Items: at(2_000_000, 5), EndCursor: "2", HasNext: true}, githost.Status{Kind: githost.KindOK}
	}
	w = walkDelta(older, 1_000_000, time.Minute, 3)
	if !w.reached || len(w.items) != 2 {
		t.Fatalf("walk = %+v, want reached with 2 items", w)
	}
}

// A continuation armed before MinGap elapses is refused by trigger and slips to the full interval.
func TestContinueWaitHonoursMinGap(t *testing.T) {
	s := newCRSyncer(nil, nil, CRSyncConfig{ContinueDelay: 5 * time.Second, MinGap: 30 * time.Second})
	now := time.Now()
	s.lastStart = now.Add(-12 * time.Second)
	if got := s.continueWaitLocked(now); got < 18*time.Second {
		t.Fatalf("wait = %v, want >= 18s (MinGap left)", got)
	}
	s.lastStart = now.Add(-time.Minute)
	if got := s.continueWaitLocked(now); got != 5*time.Second {
		t.Fatalf("wait = %v, want ContinueDelay", got)
	}
}

type pruneRecorder struct {
	ChangeRequestStore
	calls atomic.Int32
}

func (p *pruneRecorder) PruneIdle(int64) error { p.calls.Add(1); return nil }

// Every entry's first run used to prune the others' state while their runs held it in memory.
// The registry prunes once, at the first Acquire, before any syncer exists.
func TestRegistryPrunesChangeRequestsOnce(t *testing.T) {
	store := &pruneRecorder{}
	reg := newTestRegistry()
	reg.CRStore, reg.CRSync = store, CRSyncConfig{Disabled: true}
	var wg sync.WaitGroup
	for _, path := range []string{"/repo-a", "/repo-b", "/repo-c"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, release, err := reg.Acquire(context.Background(), "/usr/bin/git", path)
			if err != nil {
				t.Errorf("Acquire %s: %v", path, err)
				return
			}
			defer release()
			if n := store.calls.Load(); n != 1 {
				t.Errorf("PruneIdle calls after Acquire = %d, want 1", n)
			}
		}()
	}
	wg.Wait()
	if n := store.calls.Load(); n != 1 {
		t.Fatalf("PruneIdle calls = %d, want 1", n)
	}
}
