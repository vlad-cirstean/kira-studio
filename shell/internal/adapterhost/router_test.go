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
