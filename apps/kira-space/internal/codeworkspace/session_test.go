package codeworkspace

import (
	"context"
	"errors"
	"testing"
)

// P108 Part 20 F4: a caller can still be holding a *Session another goroutine just closed
// (CloseWorkspace, RemoveRepo, or a git.path change through Registry.Open) — before this fix,
// catfileSession respawned a fresh, never-closed cat-file pair on it (a permanent leak, CloseAll
// cannot reach a session already out of the registry), and BeginSearch handed out a live context
// CancelSearch could never reach (Registry.Peek only ever sees the registry's current session).

func TestSession_CatfileSession_AfterClose_ReturnsErrSessionClosed(t *testing.T) {
	s := &Session{RepoID: "r1", Root: t.TempDir()}
	s.Close()

	cf, err := s.catfileSession()
	if !errors.Is(err, ErrSessionClosed) {
		t.Fatalf("catfileSession() after Close: err = %v, want ErrSessionClosed", err)
	}
	if cf != nil {
		t.Fatalf("catfileSession() after Close: got non-nil *catfile.Session, want nil")
	}
}

func TestSession_CatfileSession_BeforeClose_StillConstructs(t *testing.T) {
	s := &Session{RepoID: "r1", Root: t.TempDir()}

	cf, err := s.catfileSession()
	if err != nil {
		t.Fatalf("catfileSession() before Close: unexpected err %v", err)
	}
	if cf == nil {
		t.Fatal("catfileSession() before Close: got nil *catfile.Session")
	}
	// Reuses the same lazily-constructed instance on a second call, unchanged from before F4.
	cf2, err := s.catfileSession()
	if err != nil || cf2 != cf {
		t.Fatalf("catfileSession() second call: got (%v, %v), want the same instance, nil err", cf2, err)
	}

	s.Close() // exercises the real teardown path (cf.Close()) so t.TempDir()'s own cleanup is clean.
}

func TestSession_BeginSearch_AfterClose_ReturnsAlreadyCancelledContext(t *testing.T) {
	s := &Session{RepoID: "r1", Root: t.TempDir()}
	s.Close()

	ctx := s.BeginSearch()
	select {
	case <-ctx.Done():
		if !errors.Is(ctx.Err(), context.Canceled) {
			t.Fatalf("ctx.Err() = %v, want context.Canceled", ctx.Err())
		}
	default:
		t.Fatal("BeginSearch() after Close: context is not done — a full scan could still run uncancellably")
	}

	// Close's own contract (searchCancel nil'd, spent) must still hold — a closed session never
	// starts tracking a searchCancel a later CancelSearch could act on.
	s.mu.Lock()
	sc := s.searchCancel
	s.mu.Unlock()
	if sc != nil {
		t.Fatal("BeginSearch() after Close must not install a live searchCancel")
	}
}

func TestSession_BeginSearch_BeforeClose_StillCancellable(t *testing.T) {
	s := &Session{RepoID: "r1", Root: t.TempDir()}

	ctx := s.BeginSearch()
	select {
	case <-ctx.Done():
		t.Fatal("BeginSearch() before Close: context must not start already cancelled")
	default:
	}

	s.CancelSearch()
	select {
	case <-ctx.Done():
	default:
		t.Fatal("CancelSearch() did not cancel BeginSearch's own context")
	}
}
