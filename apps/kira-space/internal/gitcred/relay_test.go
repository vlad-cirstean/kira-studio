package gitcred

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
)

type askResult struct {
	secret string
	ok     bool
}

func ask(ctx context.Context, r *Relay, source, prompt string) <-chan askResult {
	out := make(chan askResult, 1)
	go func() {
		s, ok := r.Ask(ctx, source, gitaskpass.Request{Prompt: prompt, Masked: true})
		out <- askResult{s, ok}
	}()
	return out
}

func waitPending(t *testing.T, r *Relay, n int) Snapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if snap := r.Pending(); len(snap) == n {
			return snap
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("pending never reached %d (have %d)", n, len(r.Pending()))
	return nil
}

func result(t *testing.T, ch <-chan askResult) askResult {
	t.Helper()
	select {
	case res := <-ch:
		return res
	case <-time.After(2 * time.Second):
		t.Fatal("Ask did not return")
		return askResult{}
	}
}

func TestAnswerReachesAsk(t *testing.T) {
	r := New()
	ch := ask(context.Background(), r, "vscode", "Password:")
	snap := waitPending(t, r, 1)
	secret := "hunter2"
	if !r.Provide(snap[0].RequestID, &secret) {
		t.Fatal("Provide reported the id unknown")
	}
	if got := result(t, ch); !got.ok || got.secret != secret {
		t.Fatalf("Ask = %+v, want %q answered", got, secret)
	}
	if n := len(r.Pending()); n != 0 {
		t.Fatalf("pending after answer = %d", n)
	}
}

func TestDismissalReturnsFalse(t *testing.T) {
	r := New()
	ch := ask(context.Background(), r, "vscode", "Password:")
	snap := waitPending(t, r, 1)
	if !r.Provide(snap[0].RequestID, nil) {
		t.Fatal("Provide(nil) reported the id unknown")
	}
	if got := result(t, ch); got.ok {
		t.Fatalf("dismissed Ask answered: %+v", got)
	}
}

func TestCtxCancelWithdrawsAndEmits(t *testing.T) {
	r := New()
	var mu sync.Mutex
	var seen []int
	r.Subscribe(func(s Snapshot) {
		mu.Lock()
		seen = append(seen, len(s))
		mu.Unlock()
	})
	ctx, cancel := context.WithCancel(context.Background())
	ch := ask(ctx, r, "vscode", "Password:")
	waitPending(t, r, 1)
	cancel()
	if got := result(t, ch); got.ok {
		t.Fatalf("cancelled Ask answered: %+v", got)
	}
	waitPending(t, r, 0)
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 2 || seen[0] != 1 || seen[1] != 0 {
		t.Fatalf("snapshot sizes = %v, want [1 0]", seen)
	}
}

func TestDoubleProvideIsNoOp(t *testing.T) {
	r := New()
	ch := ask(context.Background(), r, "vscode", "Password:")
	id := waitPending(t, r, 1)[0].RequestID
	first, second := "a", "b"
	if !r.Provide(id, &first) {
		t.Fatal("first Provide failed")
	}
	if r.Provide(id, &second) {
		t.Fatal("second Provide for the same id reported true")
	}
	if got := result(t, ch); got.secret != "a" {
		t.Fatalf("Ask = %+v, want the first answer", got)
	}
	if r.Provide("unknown", &second) {
		t.Fatal("unknown id reported true")
	}
}

func TestSnapshotOrderIsFIFO(t *testing.T) {
	r := New()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	prompts := []string{"p0", "p1", "p2", "p3"}
	for i, p := range prompts {
		ask(ctx, r, "vscode", p)
		waitPending(t, r, i+1)
	}
	snap := r.Pending()
	for i, p := range prompts {
		if snap[i].Prompt != p {
			t.Fatalf("snapshot[%d] = %q, want %q", i, snap[i].Prompt, p)
		}
	}
}

func TestConcurrentAsksAllResolve(t *testing.T) {
	r := New()
	const n = 20
	chans := make([]<-chan askResult, n)
	for i := range chans {
		chans[i] = ask(context.Background(), r, "vscode", "Password:")
	}
	snap := waitPending(t, r, n)
	secret := "s"
	var wg sync.WaitGroup
	for _, p := range snap {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.Provide(p.RequestID, &secret)
		}()
	}
	wg.Wait()
	for _, ch := range chans {
		if got := result(t, ch); !got.ok {
			t.Fatalf("Ask = %+v, want answered", got)
		}
	}
	waitPending(t, r, 0)
}

func TestOnAddedFiresOncePerEntry(t *testing.T) {
	r := New()
	var mu sync.Mutex
	calls := 0
	r.SetOnAdded(func() {
		mu.Lock()
		calls++
		mu.Unlock()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ask(ctx, r, "vscode", "a")
	ask(ctx, r, "vscode", "b")
	waitPending(t, r, 2)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		c := calls
		mu.Unlock()
		if c == 2 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("onAdded calls = %d, want 2", calls)
}
