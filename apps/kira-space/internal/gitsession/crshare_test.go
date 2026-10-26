package gitsession

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"
)

// Syncers on one key read the sync state, advance it and write it back whole. Without the gate a
// peer's write lands over a newer watermark; with it every run sees the previous one's result.
func TestCRSharedGateSerialisesStateReadWrite(t *testing.T) {
	share := newCRShared()
	var (
		watermark int // stands in for the persisted sync state row
		inside    int
	)
	const syncers, runs = 6, 40
	var wg sync.WaitGroup
	for range syncers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range runs {
				_, release, ok := share.acquire(context.Background(), "github|github.com|o/r")
				if !ok {
					t.Error("acquire failed on a live context")
					return
				}
				inside++
				if inside != 1 {
					t.Errorf("%d runs inside the gate", inside)
				}
				read := watermark
				runtime.Gosched()
				watermark = read + 1
				inside--
				release()
			}
		}()
	}
	wg.Wait()
	if watermark != syncers*runs {
		t.Fatalf("watermark = %d, want %d: a run wrote over a peer's state", watermark, syncers*runs)
	}
}

func TestCRSharedKeysAreIndependent(t *testing.T) {
	share := newCRShared()
	_, releaseA, ok := share.acquire(context.Background(), "a")
	if !ok {
		t.Fatal("acquire a")
	}
	defer releaseA()
	done := make(chan struct{})
	go func() {
		_, releaseB, ok := share.acquire(context.Background(), "b")
		if ok {
			releaseB()
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a held gate on one key blocked another key")
	}
}

func TestCRSharedAcquireHonoursContext(t *testing.T) {
	share := newCRShared()
	_, release, ok := share.acquire(context.Background(), "k")
	if !ok {
		t.Fatal("first acquire")
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, _, ok := share.acquire(ctx, "k"); ok {
		t.Fatal("acquire succeeded on a held gate after its context ended")
	}
}

func TestCRSharedPeers(t *testing.T) {
	share := newCRShared()
	a, b := &RepoEntry{}, &RepoEntry{}
	share.attach("k", a)
	share.attach("k", b)
	share.attach("other", a)
	if n := len(share.peers("k")); n != 2 {
		t.Fatalf("peers = %d, want 2", n)
	}
	share.detach("k", a)
	if got := share.peers("k"); len(got) != 1 || got[0] != b {
		t.Fatalf("peers after detach = %v, want [b]", got)
	}
	if share.peers("missing") != nil {
		t.Fatal("unknown key has peers")
	}
}
