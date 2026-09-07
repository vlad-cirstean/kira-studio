package gitsession

import (
	"context"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
)

// --- remoteOpSlot: D24's own ≤1-slot concurrency matrix -----------------------------------------

func TestRemoteOpSlot_SecondClaimIsRefused(t *testing.T) {
	var s remoteOpSlot
	if !s.claim("fetch", func() {}) {
		t.Fatal("first claim should succeed")
	}
	if s.claim("push", func() {}) {
		t.Fatal("a second claim while the slot is occupied should be refused")
	}
	s.release()
	if !s.claim("push", func() {}) {
		t.Fatal("a claim after release should succeed")
	}
}

func TestRemoteOpSlot_CancelOnIdleReportsFalse(t *testing.T) {
	var s remoteOpSlot
	if s.tryCancel() {
		t.Fatal("cancelling an idle slot must report false, never true")
	}
}

func TestRemoteOpSlot_CancelOnNonKillablePhaseReportsFalseAndNeverCancels(t *testing.T) {
	var s remoteOpSlot
	cancelled := false
	s.claim("push", func() { cancelled = true })
	// killable defaults to false on claim (push's own default — never killable, D19).
	if s.tryCancel() {
		t.Fatal("cancelling a non-killable phase must report false")
	}
	if cancelled {
		t.Fatal("cancel() must never be called for a non-killable phase")
	}
}

func TestRemoteOpSlot_CancelOnKillablePhaseCancelsAndReportsTrue(t *testing.T) {
	var s remoteOpSlot
	cancelled := false
	s.claim("fetch", func() { cancelled = true })
	s.setKillable(true)
	if !s.tryCancel() {
		t.Fatal("cancelling a killable phase must report true")
	}
	if !cancelled {
		t.Fatal("cancel() must have been called")
	}
}

func TestRemoteOpSlot_ForceCancelIgnoresKillable(t *testing.T) {
	var s remoteOpSlot
	cancelled := false
	s.claim("push", func() { cancelled = true })
	s.forceCancel()
	if !cancelled {
		t.Fatal("forceCancel (teardown's own) must cancel regardless of killable")
	}
}

// --- Conn credential relay: D24's own four exits -------------------------------------------------

func TestConn_AskCredential_Answered(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var secret string
	var ok bool
	go func() {
		secret, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()

	// Find the requestId the way gitrpc's credential.provide handler would — reading it back off
	// the map this test is in the same package as.
	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})

	if !c.ProvideCredential(id, strPtrLocal("hunter2")) {
		t.Fatal("ProvideCredential should find the waiter")
	}
	<-done
	if !ok || secret != "hunter2" {
		t.Fatalf("got (%q, %v), want (\"hunter2\", true)", secret, ok)
	}
}

func TestConn_AskCredential_Dismissed(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()

	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})
	if !c.ProvideCredential(id, nil) {
		t.Fatal("ProvideCredential(nil) should still find the waiter")
	}
	<-done
	if ok {
		t.Fatal("a dismissal must answer (\"\", false)")
	}
}

func TestConn_AskCredential_CtxCancelled(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(ctx, gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		return len(c.creds) == 1
	})
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("AskCredential did not return after ctx was cancelled")
	}
	if ok {
		t.Fatal("a cancelled ctx must answer (\"\", false)")
	}
}

func TestConn_AskCredential_ConnClosed(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		return len(c.creds) == 1
	})
	c.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("AskCredential did not return after the connection closed")
	}
	if ok {
		t.Fatal("a closed connection must answer (\"\", false)")
	}
}

func TestConn_ProvideCredential_UnknownIDReportsFalse(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	if c.ProvideCredential("no-such-id", strPtrLocal("x")) {
		t.Fatal("an unknown request id must report false")
	}
}

func TestConn_ProvideCredential_TwiceIsANoOp(t *testing.T) {
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	go func() {
		c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})
	if !c.ProvideCredential(id, strPtrLocal("first")) {
		t.Fatal("first ProvideCredential should succeed")
	}
	<-done
	if c.ProvideCredential(id, strPtrLocal("second")) {
		t.Fatal("a second ProvideCredential for the same (already-answered) id must report false, never an error")
	}
}

func strPtrLocal(s string) *string { return &s }

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition never became true")
}
