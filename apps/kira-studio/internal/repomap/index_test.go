package repomap

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TestWaitReadyBlocksThenProceeds is §11.2's own first claim: a tool call before ready blocks and
// then proceeds once the gate closes.
func TestWaitReadyBlocksThenProceeds(t *testing.T) {
	s := &Server{root: "/repo", ready: make(chan struct{})}

	done := make(chan error, 1)
	go func() { done <- s.waitReady(context.Background()) }()

	select {
	case err := <-done:
		t.Fatalf("waitReady returned before the gate closed (err=%v)", err)
	case <-time.After(50 * time.Millisecond):
		// still blocked, as expected
	}

	close(s.ready)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("waitReady after close(ready) = %v, want nil", err)
		}
	case <-time.After(time.Second):
		t.Fatal("waitReady did not return promptly after the gate closed")
	}
}

// TestWaitReadyTimesOut is §11.2's second claim: a tool call that outlasts the bound returns an
// error naming the repository — repomap/tools.go's own notReadyResult turns this into IsError,
// never an empty result.
func TestWaitReadyTimesOut(t *testing.T) {
	old := readyTimeout
	readyTimeout = 20 * time.Millisecond
	defer func() { readyTimeout = old }()

	s := &Server{root: "/repo", ready: make(chan struct{})}
	err := s.waitReady(context.Background())
	if err == nil {
		t.Fatal("waitReady = nil, want a timeout error")
	}
	if !strings.Contains(err.Error(), "/repo") || !strings.Contains(err.Error(), "still building") {
		t.Fatalf("waitReady error = %q, want it to name the repository and say it is still building", err.Error())
	}
}

// TestWaitReadyRespectsContextCancellation covers Close-during-a-pending-wait (§11.2's fourth
// claim): a cancelled context returns immediately rather than waiting out the full timeout.
func TestWaitReadyRespectsContextCancellation(t *testing.T) {
	old := readyTimeout
	readyTimeout = time.Minute
	defer func() { readyTimeout = old }()

	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{root: "/repo", ready: make(chan struct{})}

	done := make(chan error, 1)
	go func() { done <- s.waitReady(ctx) }()
	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("waitReady after cancel = nil, want context.Canceled")
		}
	case <-time.After(time.Second):
		t.Fatal("waitReady did not return promptly after context cancellation")
	}
}
