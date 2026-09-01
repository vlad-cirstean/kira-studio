package adapterhost

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// dataFakeAdapter is a fuller test double than host_test.go's fakeAdapter: every method the
// dispatcher can reach is overridable, so a test can assert both what was called and how many
// times. readCalls is atomic (P2 R1: a concurrency test now calls Read() from many goroutines at
// once against one shared fake).
type dataFakeAdapter struct {
	adapters.Adapter
	readCalls atomic.Int64
	readFn    func() (page.Page, error)
	// readCtxFn, when set, is used instead of readFn — for a test that needs to observe the ctx
	// Read() was actually called with (P2 R1: session cancellation propagation).
	readCtxFn func(ctx context.Context) (page.Page, error)
	mutateFn  func() (model.MutationResult, error)
}

func (a *dataFakeAdapter) Read(ctx context.Context, req adapters.ReadRequest, op *adapters.OpCtx) (page.Page, error) {
	a.readCalls.Add(1)
	if a.readCtxFn != nil {
		return a.readCtxFn(ctx)
	}
	return a.readFn()
}
func (a *dataFakeAdapter) Mutate(ctx context.Context, plan model.MutationPlan, op *adapters.OpCtx) (model.MutationResult, error) {
	return a.mutateFn()
}
func newDispatcher() (*Dispatcher, *Host) {
	cache := enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil)
	host := NewHost(adapters.Deps{}, cache)
	return NewDispatcher(host, cache), host
}

const testConnID = "conn-read"

func readReq(pageSize int) ReadRequestWire {
	return ReadRequestWire{
		OpID: "op-r1", ConnectionID: testConnID, Path: "database:app/table:t",
		PageSize: pageSize, Cursor: model.PageCursor{Mode: "offset", Offset: 0},
	}
}

// A cache miss runs the op (adapter.Read called, op:start/op:end emitted) and stores the result; a
// repeat of the exact same request is then a cache hit — server not touched again, and (the load-
// bearing assertion) no new op:start/op:end pair is emitted, because "a cache hit is not a
// database operation" (P1/P2's contract: it must not appear in the op log).
func TestDispatcher_Read_CacheAsideDiscipline(t *testing.T) {
	d, host := newDispatcher()
	fake := &dataFakeAdapter{readFn: func() (page.Page, error) {
		return page.TabularPage{RowCount: 3, ByteSize: 30}, nil
	}}
	adapters.SetLiveAdapter(testConnID, fake)
	defer adapters.DeleteLiveAdapter(testConnID)

	events, unsubscribe := host.Subscribe()
	defer unsubscribe()

	resp1, err := d.Read(context.Background(), readReq(10))
	if err != nil {
		t.Fatalf("first Read: %v", err)
	}
	if resp1.Source != "server" {
		t.Errorf("first Read source = %q, want server", resp1.Source)
	}
	if fake.readCalls.Load() != 1 {
		t.Fatalf("adapter.Read calls = %d, want 1", fake.readCalls.Load())
	}
	<-events // op:start
	<-events // op:end

	resp2, err := d.Read(context.Background(), readReq(10))
	if err != nil {
		t.Fatalf("second Read: %v", err)
	}
	if resp2.Source != "cache" {
		t.Errorf("second Read source = %q, want cache", resp2.Source)
	}
	if fake.readCalls.Load() != 1 {
		t.Errorf("adapter.Read calls after cache hit = %d, want still 1", fake.readCalls.Load())
	}
	select {
	case e := <-events:
		t.Fatalf("a cache hit must not emit an op event, got %+v", e)
	default:
	}
}

// Mutate's cache invalidation must run even when the mutation itself fails (P43 F12/D17): six of
// the eleven adapters mutate without a transaction, so a partially-applied plan still changed the
// server, and the pre-mutation page must not be left cached as a (now wrong) hit.
func TestDispatcher_Mutate_InvalidatesEvenOnFailure(t *testing.T) {
	d, _ := newDispatcher()
	fake := &dataFakeAdapter{mutateFn: func() (model.MutationResult, error) {
		return model.MutationResult{}, adapters.New(adapters.CodeQuery, "boom", nil)
	}}
	adapters.SetLiveAdapter(testConnID, fake)
	defer adapters.DeleteLiveAdapter(testConnID)

	// Seed a page and a count for this target directly through the same Cache the dispatcher
	// uses, so the test can observe whether Mutate's defer actually ran.
	req := readReq(10)
	key, label := enginecache.PageCacheKey(enginecache.ReadRequest{
		ConnectionID: req.ConnectionID, Path: req.Path, PageSize: req.PageSize, Cursor: req.Cursor,
	})
	d.cache.StorePage(key, label, enginecache.ReadRequest{ConnectionID: req.ConnectionID, Path: req.Path, PageSize: req.PageSize, Cursor: req.Cursor}, page.TabularPage{ByteSize: 10})

	_, err := d.Mutate(context.Background(), MutateRequestWire{
		OpID: "op-m1", ConnectionID: testConnID, Path: req.Path,
		Ops: []model.MutationRowOp{{Kind: "delete", Key: model.RowValues{{Name: "id", Value: strp("1")}}}},
	})
	if err == nil {
		t.Fatal("expected the mutate failure to propagate")
	}
	if _, ok := d.cache.ReadPage(key); ok {
		t.Error("a failed mutate must still drop the target's cached pages")
	}
}

// Invalidate's two scopes: "pages" drops only L2 (the post-mutation reload must leave the stale
// count mark intact); anything else (including the empty default) drops both, hard.
func TestDispatcher_Invalidate_ScopeRouting(t *testing.T) {
	d, _ := newDispatcher()
	const connID, path = "conn-inv", "database:app/table:t"
	filter := "x = 1"

	seed := func() string {
		req := ReadRequestWire{ConnectionID: connID, Path: path, PageSize: 10, Cursor: model.PageCursor{Mode: "offset"}}
		key, label := enginecache.PageCacheKey(enginecache.ReadRequest{ConnectionID: connID, Path: path, PageSize: 10, Cursor: req.Cursor})
		d.cache.StorePage(key, label, enginecache.ReadRequest{ConnectionID: connID, Path: path, PageSize: 10, Cursor: req.Cursor}, page.TabularPage{ByteSize: 5})
		d.cache.StoreCount(connID, path, &filter, 7, true)
		return key
	}

	key := seed()
	d.Invalidate(InvalidateRequestWire{ConnectionID: connID, Path: path, Scope: "pages"})
	if _, ok := d.cache.ReadPage(key); ok {
		t.Error("scope=pages must drop the cached page")
	}
	if _, ok := d.cache.Count(connID, path, &filter); !ok {
		t.Error("scope=pages must leave the count intact")
	}

	key = seed()
	d.Invalidate(InvalidateRequestWire{ConnectionID: connID, Path: path})
	if _, ok := d.cache.ReadPage(key); ok {
		t.Error("the default scope must drop the cached page")
	}
	if _, ok := d.cache.Count(connID, path, &filter); ok {
		t.Error("the default scope must drop the count too")
	}
}
