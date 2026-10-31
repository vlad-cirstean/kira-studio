package oplog

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func TestEvictionKeepsEvictedOpLive(t *testing.T) {
	l := New()
	var mu sync.Mutex
	var last Record
	l.OnUpdate(func(r Record) {
		mu.Lock()
		defer mu.Unlock()
		if r.Kind == "first" {
			last = r
		}
	})

	var cancelled atomic.Bool
	first := l.Start(context.Background(), Meta{Kind: "first"})
	first.SetCancel(func() bool { cancelled.Store(true); return true })
	for i := 0; i < FgCapacity; i++ {
		l.Start(context.Background(), Meta{Kind: "other"})
	}

	recs := l.Recent(1000)
	if len(recs) != FgCapacity {
		t.Fatalf("Recent len = %d, want %d", len(recs), FgCapacity)
	}
	for _, r := range recs {
		if r.Kind == "first" {
			t.Fatal("oldest record survived eviction")
		}
	}
	if !l.Cancel(first.rec.ID) || !cancelled.Load() {
		t.Fatal("evicted running op lost its cancel func")
	}
	first.Finish(StatusCancelled, "")
	mu.Lock()
	defer mu.Unlock()
	if last.Status != StatusCancelled || last.DurationMs == nil || last.Cancellable {
		t.Fatalf("final record after eviction = %+v", last)
	}
}

func TestCancelNeverRunsAfterClearCancel(t *testing.T) {
	for range 200 {
		l := New()
		op := l.Start(context.Background(), Meta{Kind: "fetch"})
		var calls atomic.Int32
		op.SetCancel(func() bool { calls.Add(1); return true })

		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); l.Cancel(op.rec.ID) }()
		go func() { defer wg.Done(); op.ClearCancel() }()
		wg.Wait()

		before := calls.Load()
		if l.Cancel(op.rec.ID) {
			t.Fatal("Cancel returned true after ClearCancel")
		}
		if calls.Load() != before {
			t.Fatal("cancel func ran after ClearCancel returned")
		}
	}
}

func TestConcurrentOpsEmitRunningFirstFinalLast(t *testing.T) {
	l := New()
	var mu sync.Mutex
	seen := map[string][]string{}
	l.OnUpdate(func(r Record) {
		mu.Lock()
		defer mu.Unlock()
		seen[r.ID] = append(seen[r.ID], r.Status)
	})

	const n = 64
	var wg sync.WaitGroup
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
				l.Recent(50)
			}
		}
	}()
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			op := l.Start(context.Background(), Meta{Kind: fmt.Sprint("k", i)})
			op.BeginStep([]string{"commit"}, false).End(StatusOK, nil, "")
			op.Finish(StatusOK, "")
		}()
	}
	wg.Wait()
	close(stop)

	mu.Lock()
	defer mu.Unlock()
	if len(seen) != n {
		t.Fatalf("saw %d ops, want %d", len(seen), n)
	}
	for id, st := range seen {
		if st[0] != StatusRunning || st[len(st)-1] != StatusOK {
			t.Fatalf("op %s emitted %v", id, st)
		}
	}
}

func TestBackgroundFailureDedupe(t *testing.T) {
	l := New()
	fail := func(kind, root, msg string) {
		op := l.Start(WithOrigin(context.Background(), Origin{Module: ModuleGit, Background: true}), Meta{Kind: kind, RepoRoot: root})
		op.Finish(StatusError, msg)
	}
	fail("status", "/r", "fatal: x\nmore")
	fail("status", "/r", "fatal: x\nother tail")
	fail("status", "/other", "fatal: x")
	fail("fetch", "/r", "fatal: x")
	fail("status", "/r", "fatal: different")
	recs := l.Recent(100)
	if len(recs) != 4 {
		t.Fatalf("rows = %d, want 4", len(recs))
	}
	var folded int
	for _, r := range recs {
		if r.Kind == "status" && r.RepoRoot == "/r" && r.Error != nil && *r.Error == "fatal: x\nmore" {
			folded = r.Repeat
		}
	}
	if folded != 2 {
		t.Fatalf("repeat = %d, want 2", folded)
	}
}
