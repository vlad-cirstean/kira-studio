package adapterhost

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/page"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func newTestRouter() (*Router, fakeKindLookup) {
	conns := fakeKindLookup{}
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, conns)
	return r, conns
}

func mustFrame(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal frame: %v", err)
	}
	return b
}

func readSent(t *testing.T, conn *fakeConn) map[string]any {
	t.Helper()
	return readSentWithin(t, conn, time.Second)
}

func readSentWithin(t *testing.T, conn *fakeConn, timeout time.Duration) map[string]any {
	t.Helper()
	select {
	case frame := <-conn.sent:
		var out map[string]any
		if err := json.Unmarshal(frame, &out); err != nil {
			t.Fatalf("unmarshal sent frame: %v", err)
		}
		return out
	case <-time.After(timeout):
		t.Fatalf("no frame was sent to the session within %s", timeout)
		return nil
	}
}

func assertNothingSent(t *testing.T, conn *fakeConn) {
	t.Helper()
	select {
	case frame := <-conn.sent:
		t.Fatalf("expected no frame, got %s", frame)
	case <-time.After(50 * time.Millisecond):
	}
}

// A native connection's data:read is answered locally, never forwarded — the response frame is a
// real {kind:"res", ok:true, payload:{...}} built by the dispatcher.
func TestHandleDataFrame_NativeRead_RespondsLocally(t *testing.T) {
	r, conns := newTestRouter()
	nativeKinds["fakekind"] = true
	defer delete(nativeKinds, "fakekind")
	conns["conn-1"] = "fakekind"

	fake := &dataFakeAdapter{readFn: func() (page.Page, error) {
		return page.TabularPage{RowCount: 1, ByteSize: 5}, nil
	}}
	adapters.SetLiveAdapter("conn-1", fake)
	defer adapters.DeleteLiveAdapter("conn-1")

	conn := newFakeConn()
	session, detach := r.AttachStream(conn)
	defer detach()

	frame := mustFrame(t, map[string]any{
		"kind": "req", "id": 1, "op": "data:read",
		"payload": map[string]any{
			"opId": "op-1", "tabId": nil, "connectionId": "conn-1", "path": "database:app/table:t",
			"projection": nil, "filter": nil, "sort": nil, "pageSize": 10,
			"cursor": map[string]any{"mode": "offset", "offset": 0},
		},
	})
	r.HandleDataFrame(session, frame)

	resp := readSent(t, conn)
	if resp["kind"] != "res" || resp["id"] != float64(1) || resp["ok"] != true {
		t.Fatalf("resp = %+v, want a res/1/ok:true frame", resp)
	}
	if fake.readCalls != 1 {
		t.Errorf("adapter.Read calls = %d, want 1", fake.readCalls)
	}
}

// An unknown (or non-native) connection's data op is forwarded, never answered locally — with no
// child attached, that means no frame is ever sent to the session at all.
func TestHandleDataFrame_NonNative_ForwardsNoLocalResponse(t *testing.T) {
	conns := fakeKindLookup{}
	// NewRouterAllNodeServed forwards every kind to the child, so "kafka" here stays Node-served
	// regardless of nativeKinds' own contents — the property this test needs.
	r := NewRouterAllNodeServed(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, conns)
	conns["conn-2"] = "kafka"

	conn := newFakeConn()
	session, detach := r.AttachStream(conn)
	defer detach()

	frame := mustFrame(t, map[string]any{
		"kind": "req", "id": 2, "op": "data:read",
		"payload": map[string]any{"connectionId": "conn-2", "pageSize": 10, "cursor": map[string]any{"mode": "offset", "offset": 0}},
	})
	r.HandleDataFrame(session, frame)
	assertNothingSent(t, conn)
}

// ping is answered locally — the engine is this process now (P58f D11) — with the same
// PingPayload shape rpc.ts's ping handler used to return.
func TestHandleDataFrame_Ping_AnsweredLocally(t *testing.T) {
	r, _ := newTestRouter()
	conn := newFakeConn()
	session, detach := r.AttachStream(conn)
	defer detach()

	r.HandleDataFrame(session, mustFrame(t, map[string]any{"kind": "req", "id": 3, "op": "ping"}))
	resp := readSent(t, conn)
	if resp["kind"] != "res" || resp["id"] != float64(3) || resp["ok"] != true {
		t.Fatalf("resp = %+v, want a res/3/ok:true frame", resp)
	}
	payload, ok := resp["payload"].(map[string]any)
	if !ok {
		t.Fatalf("resp.payload = %+v, want an object", resp["payload"])
	}
	if payload["pong"] != true {
		t.Errorf("payload.pong = %v, want true", payload["pong"])
	}
	if pid, ok := payload["enginePid"].(float64); !ok || int(pid) != os.Getpid() {
		t.Errorf("payload.enginePid = %v, want %d", payload["enginePid"], os.Getpid())
	}
	if at, ok := payload["at"].(float64); !ok || at <= 0 {
		t.Errorf("payload.at = %v, want a positive unix-millis timestamp", payload["at"])
	}
}

// cache:clear clears the Go-native cache synchronously, regardless of whether a child is attached
// to receive the forwarded copy.
func TestHandleDataFrame_CacheClear_ClearsGoCache(t *testing.T) {
	r, _ := newTestRouter()
	cacheReq := enginecache.ReadRequest{ConnectionID: "c", Path: "p", PageSize: 10, Cursor: model.PageCursor{Mode: "offset"}}
	key, label := enginecache.PageCacheKey(cacheReq)
	r.cache.StorePage(key, label, cacheReq, page.TabularPage{ByteSize: 5})
	if r.cache.Stats().L2Entries != 1 {
		t.Fatal("setup: expected the seeded page to be cached")
	}

	conn := newFakeConn()
	session, detach := r.AttachStream(conn)
	defer detach()
	r.HandleDataFrame(session, mustFrame(t, map[string]any{"kind": "req", "id": 4, "op": "cache:clear"}))

	if r.cache.Stats().L2Entries != 0 {
		t.Error("cache:clear must clear the Go-native cache")
	}
}

// D12: a session subscribes to the Go cache's stats-changed notifications on attach and gets an
// unsolicited cache:stats event frame when they fire; detach unsubscribes.
func TestAttachStream_PushesCacheStatsOnChange(t *testing.T) {
	r, _ := newTestRouter()
	conn := newFakeConn()
	_, detach := r.AttachStream(conn)

	cacheReq := enginecache.ReadRequest{ConnectionID: "c", Path: "p", PageSize: 10, Cursor: model.PageCursor{Mode: "offset"}}
	key, label := enginecache.PageCacheKey(cacheReq)
	r.cache.StorePage(key, label, cacheReq, page.TabularPage{ByteSize: 5})

	// The cache's own emit is throttled to at most 1 Hz (scheduleEmitLocked); give it real margin
	// past that so this isn't a race against the cache's own timer.
	evt := readSentWithin(t, conn, 3*time.Second)
	if evt["kind"] != "evt" || evt["topic"] != "cache:stats" {
		t.Fatalf("evt = %+v, want a cache:stats event frame", evt)
	}
	payload, ok := evt["payload"].(map[string]any)
	if !ok {
		t.Fatalf("evt payload = %+v, want a CacheStats object", evt["payload"])
	}
	if payload["l2Entries"] != float64(1) {
		t.Errorf("l2Entries = %v, want 1", payload["l2Entries"])
	}

	detach()
	r.cache.Clear()
	assertNothingSent(t, conn)
}

// A16: counters sum; the budget reports once, not doubled.
func TestMergedCacheStats_SumsCountersReportsBudgetOnce(t *testing.T) {
	r, _ := newTestRouter()
	r.statsMu.Lock()
	r.lastChildStats = enginecache.CacheStats{L2Bytes: 1000, L2BudgetBytes: 64 << 20, L2Entries: 10, L2Hits: 20, L2Misses: 5, L3Entries: 7}
	r.haveChildStats = true
	r.statsMu.Unlock()

	got := r.mergedCacheStats()
	goStats := r.cache.Stats() // all zero: nothing native has run in this test
	if got.L2BudgetBytes != goStats.L2BudgetBytes {
		t.Errorf("L2BudgetBytes = %d, want the Go side's own configured budget (%d), not summed", got.L2BudgetBytes, goStats.L2BudgetBytes)
	}
	if got.L2Bytes != 1000 || got.L2Entries != 10 || got.L2Hits != 20 || got.L2Misses != 5 || got.L3Entries != 7 {
		t.Errorf("got = %+v, want the child's counters summed with Go's own (zero here)", got)
	}
}
