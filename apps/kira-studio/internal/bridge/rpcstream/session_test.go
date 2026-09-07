package rpcstream

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// internalPipeSession mirrors gitstream_test.go's own pipeSession (package bridge_test) —
// duplicated rather than shared because this file lives in package rpcstream, the one place
// session/Emit are reachable at all, and the two files otherwise test genuinely different things
// (the public wire contract vs. this one internal-only capability).
type internalPipeSession struct {
	in     chan []byte
	out    chan []byte
	closed chan struct{}
}

func newInternalPipeSession() *internalPipeSession {
	return &internalPipeSession{in: make(chan []byte, 4), out: make(chan []byte, 4), closed: make(chan struct{})}
}

func (p *internalPipeSession) Send(frame []byte) error {
	select {
	case p.out <- frame:
		return nil
	case <-p.closed:
		return errors.New("closed")
	}
}

func (p *internalPipeSession) Receive() ([]byte, error) {
	select {
	case b := <-p.in:
		return b, nil
	case <-p.closed:
		return nil, errors.New("closed")
	}
}

// TestSession_Emit_EventCrosses is §7's own exit-criterion proof for the event half of the frame
// protocol: gitclient's Watcher has no production wiring into repo.changed yet (P2's row, §0.2), so
// this is the honest place to prove 'evt' frames cross correctly — directly, since nothing in P1's
// own production path calls Emit yet for a bridge_test-level (black-box) test to observe.
func TestSession_Emit_EventCrosses(t *testing.T) {
	conn := newInternalPipeSession()
	// Emit never touches h — a zero-value Request/Stream pair (never invoked in this test) plus
	// a contract version is enough to construct a session to Emit through.
	const contractVersion = 3
	session := newSession(conn, Handlers{ContractVersion: contractVersion})
	defer session.close()

	type payload struct {
		RepoID string `json:"repoId"`
		Kind   string `json:"kind"`
	}
	session.Emit("repo.changed", payload{RepoID: "abc", Kind: "refsChanged"})

	select {
	case raw := <-conn.out:
		var env envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if env.Version != contractVersion {
			t.Errorf("Version = %d, want %d", env.Version, contractVersion)
		}
		if env.Body.T != "evt" || env.Body.Method != "repo.changed" {
			t.Fatalf("Body = %+v, want an evt frame for repo.changed", env.Body)
		}
		var got payload
		if err := json.Unmarshal(env.Body.Payload, &got); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if got.RepoID != "abc" || got.Kind != "refsChanged" {
			t.Errorf("payload = %+v, want {abc refsChanged}", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the emitted event")
	}
}

// TestCreditGate_GrantUnblocksAcquire proves the credit gate's own contract in isolation — a
// waiter blocked on acquire is released by grant, exactly once per unit of credit.
func TestCreditGate_GrantUnblocksAcquire(t *testing.T) {
	g := newCreditGate()
	done := make(chan error, 1)
	go func() {
		done <- g.acquire(context.Background())
	}()

	select {
	case <-done:
		t.Fatal("acquire returned before any credit was granted")
	case <-time.After(20 * time.Millisecond):
	}

	g.grant(1)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("acquire: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("acquire did not unblock after grant")
	}
}

func TestCreditGate_AcquireRespectsCancellation(t *testing.T) {
	g := newCreditGate()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := g.acquire(ctx); err == nil {
		t.Fatal("acquire with an already-cancelled context: want an error")
	}
}
