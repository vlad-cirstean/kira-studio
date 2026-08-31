package adapterhost

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// Cancel must find an op this router's own scheduler started.
func TestRouter_Cancel_FindsInProcessOp(t *testing.T) {
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil))
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

// childrenNilAdapter returns a nil Nodes slice, the idiomatic-Go shape (`var result
// []model.TreeNode`, never appended to) that json.Marshal renders as `null`.
type childrenNilAdapter struct {
	adapters.Adapter
}

func (childrenNilAdapter) Children(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (adapters.TreeChildren, error) {
	var nodes []model.TreeNode
	return adapters.TreeChildren{Nodes: nodes}, nil
}

// C16: a native adapter's nil Nodes slice must cross the wire as `[]`, never `null` — the same
// hazard describeNative/definitionNative were already fixed for at P58b's closeout. Asserting on
// the marshalled JSON, not len(nodes)==0, is the point: len() is 0 for both nil and empty slices,
// so a test that only checked length would pass on the very bug this guards against.
func TestRouter_ChildrenNative_NilNodesMarshalAsEmptyArray(t *testing.T) {
	const connID = "conn-children-nil"
	adapters.SetLiveAdapter(connID, childrenNilAdapter{})
	defer adapters.DeleteLiveAdapter(connID)

	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil))
	children, err := r.childrenNative(context.Background(), connID, model.NodePath{ConnectionID: connID})
	if err != nil {
		t.Fatalf("childrenNative: %v", err)
	}
	if children.Nodes == nil {
		t.Fatal("childrenNative must normalize a nil Nodes slice before returning")
	}

	b, err := json.Marshal(children)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !strings.Contains(string(b), `"Nodes":[]`) {
		t.Errorf("marshalled = %s, want a \"Nodes\":[] field, not null", b)
	}
}
