package shell

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDebouncerCoalescesBurstIntoOneCallWithLastClosure(t *testing.T) {
	db := newDebouncer(20 * time.Millisecond)
	var calls atomic.Int32
	var lastArg atomic.Int32

	for i := int32(1); i <= 3; i++ {
		i := i
		db.trigger(func() {
			calls.Add(1)
			lastArg.Store(i)
		})
	}

	time.Sleep(80 * time.Millisecond)
	if got := calls.Load(); got != 1 {
		t.Fatalf("calls = %d, want 1 (a burst inside the window must coalesce)", got)
	}
	if got := lastArg.Load(); got != 3 {
		t.Errorf("last-fired closure carried %d, want 3 (the last trigger's closure must win)", got)
	}
}

func TestDebouncerFiresAgainAfterTheWindowElapses(t *testing.T) {
	db := newDebouncer(15 * time.Millisecond)
	var calls atomic.Int32

	db.trigger(func() { calls.Add(1) })
	time.Sleep(60 * time.Millisecond)
	db.trigger(func() { calls.Add(1) })
	time.Sleep(60 * time.Millisecond)

	if got := calls.Load(); got != 2 {
		t.Errorf("calls = %d, want 2 (a trigger after the window elapsed is a new, independent fire)", got)
	}
}

func TestDebouncerCancelBeforeFireRunsNothing(t *testing.T) {
	db := newDebouncer(15 * time.Millisecond)
	var calls atomic.Int32

	db.trigger(func() { calls.Add(1) })
	db.cancel()
	time.Sleep(60 * time.Millisecond)

	if got := calls.Load(); got != 0 {
		t.Errorf("calls = %d, want 0 (cancel before the window elapses must suppress the fire)", got)
	}
}

func TestDebouncerCancelWithNothingPendingIsSafe(t *testing.T) {
	db := newDebouncer(15 * time.Millisecond)
	db.cancel()
	db.cancel()
}

func TestDebouncerConcurrentTriggerAndCancelIsRaceFree(t *testing.T) {
	db := newDebouncer(time.Millisecond)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); db.trigger(func() {}) }()
		go func() { defer wg.Done(); db.cancel() }()
	}
	wg.Wait()
}
