package adapterhost

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/oplog"
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

// describeDefinitionFakeAdapter answers Describe/Definition with minimal fixtures.
type describeDefinitionFakeAdapter struct {
	adapters.Adapter
}

func (describeDefinitionFakeAdapter) Describe(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectMeta, error) {
	return model.ObjectMeta{}, nil
}

func (describeDefinitionFakeAdapter) Definition(ctx context.Context, path model.NodePath, op *adapters.OpCtx) (model.ObjectDefinition, error) {
	return model.ObjectDefinition{}, nil
}

// P2 R1: Describe/Definition must thread tabID through to the op:start event the same way every
// other tab-scoped op does — the frontend's per-tab op log and status bar key off it. router.go
// used to accept tabID from tree.Backend's own signature and then never put it in the OpSpec it
// built, so op:start always reported a nil TabID for these two kinds.
func TestRouter_DescribeAndDefinition_ThreadTabIDIntoOpStart(t *testing.T) {
	const connID = "conn-tabid"
	adapters.SetLiveAdapter(connID, describeDefinitionFakeAdapter{})
	defer adapters.DeleteLiveAdapter(connID)

	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil))
	events, unsubscribe := r.Host().Subscribe()
	defer unsubscribe()

	awaitOpStartTabID := func(t *testing.T, kind string) *string {
		t.Helper()
		for {
			select {
			case evt := <-events:
				if evt.Topic != oplog.EventOpStart {
					continue
				}
				var payload struct {
					Kind  string  `json:"kind"`
					TabID *string `json:"tabId"`
				}
				if err := json.Unmarshal(evt.Payload, &payload); err != nil {
					t.Fatalf("unmarshal op:start payload: %v", err)
				}
				if payload.Kind != kind {
					continue
				}
				return payload.TabID
			case <-time.After(time.Second):
				t.Fatalf("no op:start event for kind %q within 1s", kind)
				return nil
			}
		}
	}

	tabID := "tab-1"
	if _, err := r.Describe(context.Background(), connID, model.NodePath{ConnectionID: connID}, &tabID); err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if got := awaitOpStartTabID(t, "describe"); got == nil || *got != tabID {
		t.Errorf("describe op:start TabID = %v, want %q", got, tabID)
	}

	if _, err := r.Definition(context.Background(), connID, model.NodePath{ConnectionID: connID}, &tabID); err != nil {
		t.Fatalf("Definition: %v", err)
	}
	if got := awaitOpStartTabID(t, "definition"); got == nil || *got != tabID {
		t.Errorf("definition op:start TabID = %v, want %q", got, tabID)
	}
}
