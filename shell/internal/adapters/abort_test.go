package adapters_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
)

func TestRunWithAbortRace_CompletesBeforeCancel(t *testing.T) {
	var released int32
	release := func() { atomic.AddInt32(&released, 1) }

	v, err := adapters.RunWithAbortRace(context.Background(), release, func(ctx context.Context) (int, error) {
		return 42, nil
	})
	if err != nil || v != 42 {
		t.Fatalf("got %v, %v, want 42, nil", v, err)
	}
	if atomic.LoadInt32(&released) != 1 {
		t.Errorf("release called %d times, want 1", released)
	}
}

func TestRunWithAbortRace_CallerCtxCancelledDoesNotReachIssue(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	issueSawDone := make(chan bool, 1)
	releaseCh := make(chan struct{})

	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err := adapters.RunWithAbortRace(ctx, func() { close(releaseCh) }, func(issueCtx context.Context) (int, error) {
		// issueCtx must be detached from ctx's own cancellation (context.WithoutCancel) — block
		// past the caller's cancel and confirm issueCtx itself never observes it.
		select {
		case <-issueCtx.Done():
			issueSawDone <- true
		case <-time.After(200 * time.Millisecond):
			issueSawDone <- false
		}
		return 0, nil
	})
	elapsed := time.Since(start)

	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeCancelled {
		t.Fatalf("got %v, want an E_CANCELLED *adapters.Error", err)
	}
	if elapsed > 100*time.Millisecond {
		t.Errorf("RunWithAbortRace returned after %s, want it to return promptly on ctx.Done()", elapsed)
	}
	if <-issueSawDone {
		t.Error("issue's own context observed Done() — it must be detached from the caller's ctx")
	}

	select {
	case <-releaseCh:
	case <-time.After(1 * time.Second):
		t.Error("release was never called once issue actually settled")
	}
}

func TestRunWithAbortRace_ReleaseCalledExactlyOnce(t *testing.T) {
	var released int32
	release := func() { atomic.AddInt32(&released, 1) }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := adapters.RunWithAbortRace(ctx, release, func(issueCtx context.Context) (int, error) {
		return 0, errors.New("boom")
	})
	if err == nil {
		t.Fatal("expected an error from issue")
	}
	if atomic.LoadInt32(&released) != 1 {
		t.Errorf("release called %d times, want exactly 1", released)
	}
}
