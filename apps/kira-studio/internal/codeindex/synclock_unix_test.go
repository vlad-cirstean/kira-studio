//go:build unix

package codeindex

import (
	"context"
	"testing"
	"time"
)

// TestAcquireSyncLockSecondWaits is the C3 §11.2 claim this test carried before moving here (C6
// S1): a second process holding the flock makes the first wait — proven here as one process, two
// sequential acquisitions of the same repoID/home pair, since a second acquireLock on an
// already-locked path from the *same* process would deadlock (flock is per-open-file-description
// on Linux, but this codebase's own lock file is meant to coordinate across processes, so the
// meaningful assertion is "still locked until released," not "another goroutine in this process
// can't also lock it" — os.Exec'ing a second real process for a unit test is disproportionate to
// what this is verifying).
func TestAcquireSyncLockSecondWaits(t *testing.T) {
	home := t.TempDir()
	repoID := "test-repo"

	lock, acquired, err := AcquireSyncLock(context.Background(), home, repoID, time.Second)
	if err != nil {
		t.Fatalf("AcquireSyncLock: %v", err)
	}
	if !acquired {
		t.Fatal("first AcquireSyncLock did not acquire the lock")
	}

	// A second attempt via a fresh *os.File handle on the same path must wait — flock is
	// per-open-file-description, so this genuinely exercises cross-descriptor contention, the
	// same shape two separate processes would see.
	start := time.Now()
	_, acquired2, err := AcquireSyncLock(context.Background(), home, repoID, 100*time.Millisecond)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("second AcquireSyncLock: %v", err)
	}
	if acquired2 {
		t.Fatal("second AcquireSyncLock succeeded while the first still holds the lock")
	}
	if elapsed < 90*time.Millisecond {
		t.Fatalf("second AcquireSyncLock returned after %s, want it to wait out its own timeout", elapsed)
	}

	lock.Release()

	// Once released, a fresh acquisition succeeds promptly.
	lock2, acquired3, err := AcquireSyncLock(context.Background(), home, repoID, time.Second)
	if err != nil {
		t.Fatalf("third AcquireSyncLock: %v", err)
	}
	if !acquired3 {
		t.Fatal("third AcquireSyncLock did not acquire the lock after release")
	}
	lock2.Release()
}

// TestAcquireSyncLockCtxCancelInterruptsWait is Group 1b's own claim: cancelling ctx must cut the
// poll loop short well before the lock's own timeout, not just before the caller gets back
// control after the full wait — the whole point of threading ctx through here at all.
func TestAcquireSyncLockCtxCancelInterruptsWait(t *testing.T) {
	home := t.TempDir()
	repoID := "test-repo"

	lock, acquired, err := AcquireSyncLock(context.Background(), home, repoID, time.Second)
	if err != nil {
		t.Fatalf("AcquireSyncLock: %v", err)
	}
	if !acquired {
		t.Fatal("first AcquireSyncLock did not acquire the lock")
	}
	defer lock.Release()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, acquired2, err := AcquireSyncLock(ctx, home, repoID, time.Minute)
	elapsed := time.Since(start)
	if acquired2 {
		t.Fatal("second AcquireSyncLock succeeded while the first still holds the lock")
	}
	if err == nil {
		t.Fatal("AcquireSyncLock with a cancelled ctx returned a nil error")
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("AcquireSyncLock took %s to notice ctx cancellation, want well under its own 1-minute timeout", elapsed)
	}
}
