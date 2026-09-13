//go:build unix

package repomap

import (
	"path/filepath"
	"testing"
	"time"
)

// TestAcquireLockSecondWaits is §11.2's third claim: a second process holding the flock makes the
// first wait — proven here as one process, two sequential acquisitions of the same path, since a
// second acquireLock on an already-locked path from the *same* process would deadlock (flock is
// per-open-file-description on Linux, but this codebase's own lock file is meant to coordinate
// across processes, so the meaningful assertion is "still locked until released," not "another
// goroutine in this process can't also lock it" — os.Exec'ing a second real process for a unit
// test is disproportionate to what this is verifying).
func TestAcquireLockSecondWaits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.lock")

	lock, acquired, err := acquireLock(path, time.Second)
	if err != nil {
		t.Fatalf("acquireLock: %v", err)
	}
	if !acquired {
		t.Fatal("first acquireLock did not acquire the lock")
	}

	// A second attempt via a fresh *os.File handle on the same path must wait — flock is
	// per-open-file-description, so this genuinely exercises cross-descriptor contention, the same
	// shape two separate processes would see.
	start := time.Now()
	_, acquired2, err := acquireLock(path, 100*time.Millisecond)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("second acquireLock: %v", err)
	}
	if acquired2 {
		t.Fatal("second acquireLock succeeded while the first still holds the lock")
	}
	if elapsed < 90*time.Millisecond {
		t.Fatalf("second acquireLock returned after %s, want it to wait out its own timeout", elapsed)
	}

	lock.release()

	// Once released, a fresh acquisition succeeds promptly.
	lock2, acquired3, err := acquireLock(path, time.Second)
	if err != nil {
		t.Fatalf("third acquireLock: %v", err)
	}
	if !acquired3 {
		t.Fatal("third acquireLock did not acquire the lock after release")
	}
	lock2.release()
}
