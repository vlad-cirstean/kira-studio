package adapterhost

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/oplog"
)

// fakeAdapter overrides only the methods a test needs; every other adapters.Adapter method panics
// via the embedded nil interface if a test accidentally reaches it.
type fakeAdapter struct {
	adapters.Adapter
	cancelFn func(ctx context.Context, opID string) (bool, error)
}

func (f *fakeAdapter) Cancel(ctx context.Context, opID string) (bool, error) {
	return f.cancelFn(ctx, opID)
}

// RunOp must refuse a duplicate op id outright — scheduler/ops.ts's own reasoning is that a
// duplicate id would corrupt the op log's primary key and let the stop button cancel the wrong
// query, so this is checked before op:start is even emitted, not caught downstream.
func TestRunOp_RefusesDuplicateOpID(t *testing.T) {
	h := NewHost(adapters.Deps{}, nil)
	release := make(chan struct{})
	started := make(chan struct{})

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _, _ = h.RunOp(context.Background(), OpSpec{OpID: "op-1", Kind: "read"},
			func(ctx context.Context, op *adapters.OpCtx) (any, error) {
				close(started)
				<-release
				return nil, nil
			})
	}()
	<-started

	_, _, err := h.RunOp(context.Background(), OpSpec{OpID: "op-1", Kind: "read"},
		func(ctx context.Context, op *adapters.OpCtx) (any, error) {
			t.Fatal("the duplicate call's fn must never run")
			return nil, nil
		})
	if err == nil {
		t.Fatal("expected an error for a duplicate op id")
	}
	var ae *adapters.Error
	if !errors.As(err, &ae) || ae.Code != adapters.CodeQuery {
		t.Fatalf("got %v, want an E_QUERY *adapters.Error", err)
	}
	if ae.Message != "duplicate operation id: op-1" {
		t.Errorf("message = %q", ae.Message)
	}

	close(release)
	wg.Wait()
}

// CancelOp must stay two-step and in order: the local abort unblocks the running RunOp call
// immediately (never mind whether the adapter ever answers), and only then is the adapter's own
// Cancel called — the one that actually kills the server-side work (§5.1: cancellation is always
// forwarded, and the local abort alone is not a cancel).
func TestCancelOp_LocalAbortThenAdapterCancel(t *testing.T) {
	h := NewHost(adapters.Deps{}, nil)
	const connID = "conn-1"

	cancelCalled := make(chan string, 1)
	fake := &fakeAdapter{cancelFn: func(ctx context.Context, opID string) (bool, error) {
		cancelCalled <- opID
		return true, nil
	}}
	adapters.SetLiveAdapter(connID, fake)
	defer adapters.DeleteLiveAdapter(connID)

	opStarted := make(chan struct{})
	opDone := make(chan struct{})
	var derivedCtx context.Context
	go func() {
		_, _, _ = h.RunOp(context.Background(), OpSpec{OpID: "op-2", Kind: "read", ConnectionID: strp(connID)},
			func(ctx context.Context, op *adapters.OpCtx) (any, error) {
				derivedCtx = ctx
				close(opStarted)
				<-ctx.Done()
				return nil, ctx.Err()
			})
		close(opDone)
	}()
	<-opStarted

	ok, err := h.CancelOp(context.Background(), "op-2")
	if err != nil || !ok {
		t.Fatalf("CancelOp = %v, %v, want true, nil", ok, err)
	}
	// By the time CancelOp returns, the local abort must already have unblocked RunOp's fn —
	// CancelOp calls op.cancel() before it ever touches the adapter, so this holds regardless of
	// how long the fake adapter's own Cancel takes to answer.
	if derivedCtx.Err() == nil {
		t.Error("the local context must already be cancelled once CancelOp returns")
	}

	select {
	case opID := <-cancelCalled:
		if opID != "op-2" {
			t.Errorf("adapter.Cancel called with opID %q, want op-2", opID)
		}
	case <-time.After(time.Second):
		t.Fatal("adapter.Cancel was never called")
	}
	<-opDone

	// A second cancel of the same, now-finished op is a no-op — cancel() "never throws for
	// already finished".
	ok2, err2 := h.CancelOp(context.Background(), "op-2")
	if err2 != nil || ok2 {
		t.Fatalf("second CancelOp = %v, %v, want false, nil", ok2, err2)
	}
}

// Unsubscribe must never panic even when it races a concurrent Emit trying to deliver into the
// same channel — the exact bug eventSub's own mutex exists to prevent (host.go's doc comment on
// eventSub explains why notify.Emitter's own contract makes this possible). Run with -race.
func TestSubscribe_UnsubscribeRacesEmitWithoutPanicking(t *testing.T) {
	h := NewHost(adapters.Deps{}, nil)
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		_, unsubscribe := h.Subscribe()
		wg.Add(2)
		go func() {
			defer wg.Done()
			h.emitJSON(oplog.EventOpStart, opStartPayload{OpID: "x"})
		}()
		go func() {
			defer wg.Done()
			unsubscribe()
		}()
	}
	wg.Wait()
}

func strp(s string) *string { return &s }
