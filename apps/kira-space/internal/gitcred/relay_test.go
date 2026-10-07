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
