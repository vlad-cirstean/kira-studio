package adapterhost

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
)

type fakeKindLookup map[string]string

func (f fakeKindLookup) KindOf(connectionID string) (string, bool) {
	kind, ok := f[connectionID]
	return kind, ok
}

func TestRouter_IsNativeKind(t *testing.T) {
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	if !r.IsNativeKind("postgres") {
		t.Error("postgres has been native since M5 — it should already report native")
	}
	if r.IsNativeKind(TestKindNodeServed) {
		t.Errorf("%s has no Go adapter — nothing else should report native", TestKindNodeServed)
	}

	nativeKinds["mariadb"] = true
	defer delete(nativeKinds, "mariadb")
	if !r.IsNativeKind("mariadb") {
		t.Error("IsNativeKind must reflect nativeKinds live, not a snapshot taken at construction")
	}
	if r.IsNativeKind(TestKindNodeServed) {
		t.Error("only the kind actually added to nativeKinds should report native")
	}
}

// Cancel asks the in-process scheduler first; with no child attached and the op unknown here,
// it must report false rather than panicking on a nil child.
func TestRouter_Cancel_UnknownOpNoChild(t *testing.T) {
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	ok, err := r.Cancel(context.Background(), "no-such-op")
	if err != nil || ok {
		t.Fatalf("Cancel = %v, %v, want false, nil", ok, err)
	}
}

// Cancel must find an op this router's own scheduler started without ever touching the child.
func TestRouter_Cancel_FindsInProcessOp(t *testing.T) {
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	started := make(chan struct{})
	done := make(chan struct{})
	go func() {
		_, _, _ = r.host.RunOp(context.Background(), OpSpec{OpID: "op-x", Kind: "read"},
			func(ctx context.Context, op *adapters.OpCtx) (any, error) {
				close(started)
				<-ctx.Done()
				return nil, ctx.Err()
			})
		close(done)
	}()
	<-started

	ok, err := r.Cancel(context.Background(), "op-x")
	if err != nil || !ok {
		t.Fatalf("Cancel = %v, %v, want true, nil", ok, err)
	}
	<-done
}
