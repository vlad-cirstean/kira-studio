package oplog_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/oplog"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// fakeSource is an EventSource a test drives directly, without a real engine child.
type fakeSource struct {
	ch chan enginehost.Event
}

func newFakeSource() *fakeSource {
	return &fakeSource{ch: make(chan enginehost.Event, 1024)}
}

func (f *fakeSource) Subscribe() (<-chan enginehost.Event, func()) {
	return f.ch, func() { close(f.ch) }
}

type harness struct {
	wiring *oplog.Wiring
	src    *fakeSource
	ops    *repos.OpsRepo
}

func newHarness(t *testing.T, retentionDays int) *harness {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	src := newFakeSource()
	w := oplog.New(src, r.Ops, retentionDays)
	return &harness{wiring: w, src: src, ops: r.Ops}
}

func opStartPayload(opID string, connectionID, tabID *string, kind, startedAt string) json.RawMessage {
	b, _ := json.Marshal(map[string]any{
		"opId": opID, "connectionId": connectionID, "tabId": tabID, "kind": kind, "startedAt": startedAt,
	})
	return b
}

func opEndPayload(opID, status string) json.RawMessage {
	b, _ := json.Marshal(map[string]any{
		"opId": opID, "status": status, "durationMs": 1, "rows": nil, "command": nil, "error": nil,
	})
	return b
}

func seedRawOp(t *testing.T, ops *repos.OpsRepo, id, startedAt string) {
	t.Helper()
	if _, err := ops.DB.Exec(
		`INSERT INTO op_log (id, connection_id, tab_id, started_at, duration_ms, kind, status, rows, command, error)
		 VALUES (?, NULL, NULL, ?, NULL, 'read', 'running', NULL, NULL, NULL)`,
		id, startedAt,
	); err != nil {
		t.Fatalf("seed op %s: %v", id, err)
	}
}

// seedConnection inserts a bare connections row so an op_log row can reference it — op_log.
// connection_id has a real foreign key to connections(id).
func seedConnection(t *testing.T, ops *repos.OpsRepo, id string) {
	t.Helper()
	now := model.NowISO()
	if _, err := ops.DB.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES (?, ?, 'postgres', 'blue', 'fields', 0, ?, ?, 0)`,
		id, id, now, now,
	); err != nil {
		t.Fatalf("seed connection %s: %v", id, err)
	}
}

func rowExists(t *testing.T, ops *repos.OpsRepo, id string) bool {
	t.Helper()
	var exists int
	err := ops.DB.QueryRow(`SELECT 1 FROM op_log WHERE id = ?`, id).Scan(&exists)
	if err == sql.ErrNoRows {
		return false
	}
	if err != nil {
		t.Fatalf("query %s: %v", id, err)
	}
	return true
}

func fetchOp(t *testing.T, ops *repos.OpsRepo, id string) model.OpRecord {
	t.Helper()
	recs, err := ops.Recent(1000)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	for _, r := range recs {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("no op_log row for %s", id)
	return model.OpRecord{}
}

func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

// updateCollector is an OnUpdate sink safe for concurrent use.
type updateCollector struct {
	mu   sync.Mutex
	recs []model.OpRecord
}

func (c *updateCollector) handle(r model.OpRecord) {
	c.mu.Lock()
	c.recs = append(c.recs, r)
	c.mu.Unlock()
}

func (c *updateCollector) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.recs)
}

func (c *updateCollector) at(i int) model.OpRecord {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.recs[i]
}

func strp(s string) *string { return &s }

func TestStartEndRowLifecycle(t *testing.T) {
	h := newHarness(t, 30)
	seedConnection(t, h.ops, "c1")
	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)
	h.wiring.Start()
	t.Cleanup(h.wiring.Stop)

	startedAt := model.NowISO()
	h.src.ch <- enginehost.Event{
		Topic:   enginehost.EventOpStart,
		Payload: opStartPayload("op1", strp("c1"), strp("t1"), "read", startedAt),
	}
	waitUntil(t, time.Second, func() bool { return updates.count() >= 1 })
	running := updates.at(0)
	if running.Status != "running" || running.ConnectionID == nil || *running.ConnectionID != "c1" {
		t.Fatalf("first update = %+v, want a running record for c1", running)
	}
	row := fetchOp(t, h.ops, "op1")
	if row.Status != "running" {
		t.Errorf("DB row status = %q, want running", row.Status)
	}

	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload("op1", "ok")}
	waitUntil(t, time.Second, func() bool { return updates.count() >= 2 })
	final := updates.at(1)
	if final.Status != "ok" {
		t.Errorf("final Status = %q, want ok", final.Status)
	}
	if final.ConnectionID == nil || *final.ConnectionID != "c1" {
		t.Errorf("final ConnectionID = %v, want c1 (carried from the matching op:start)", final.ConnectionID)
	}
	if final.TabID == nil || *final.TabID != "t1" {
		t.Errorf("final TabID = %v, want t1", final.TabID)
	}
	if final.Kind != "read" {
		t.Errorf("final Kind = %q, want read", final.Kind)
	}
	row = fetchOp(t, h.ops, "op1")
	if row.Status != "ok" {
		t.Errorf("DB row status = %q, want ok", row.Status)
	}
}

func TestUnknownOpEndUsesFallbacks(t *testing.T) {
	h := newHarness(t, 30)
	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)
	h.wiring.Start()
	t.Cleanup(h.wiring.Stop)

	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload("op-unknown", "ok")}
	waitUntil(t, time.Second, func() bool { return updates.count() >= 1 })
	rec := updates.at(0)
	if rec.ConnectionID != nil {
		t.Errorf("ConnectionID = %v, want nil", rec.ConnectionID)
	}
	if rec.TabID != nil {
		t.Errorf("TabID = %v, want nil", rec.TabID)
	}
	if rec.Kind != "test" {
		t.Errorf("Kind = %q, want test", rec.Kind)
	}
}

func TestMalformedEventsAreDropped(t *testing.T) {
	h := newHarness(t, 30)
	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)
	h.wiring.Start()
	t.Cleanup(h.wiring.Stop)

	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpStart, Payload: json.RawMessage(`not json`)}
	h.src.ch <- enginehost.Event{
		Topic:   enginehost.EventOpStart,
		Payload: opStartPayload("op-bad-kind", nil, nil, "bogus-kind", model.NowISO()),
	}
	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload("op-bad-status", "bogus-status")}

	// Prove the queue actually drained (rather than merely not having emitted yet) with one real
	// event, then assert nothing from the three malformed ones landed either as a DB row or an
	// update.
	h.src.ch <- enginehost.Event{
		Topic:   enginehost.EventOpStart,
		Payload: opStartPayload("op-good", nil, nil, "read", model.NowISO()),
	}
	waitUntil(t, time.Second, func() bool { return updates.count() >= 1 })

	if updates.count() != 1 {
		t.Fatalf("got %d updates, want exactly 1 (the malformed events must emit nothing)", updates.count())
	}
	for _, id := range []string{"op-bad-kind", "op-bad-status"} {
		if rowExists(t, h.ops, id) {
			t.Errorf("a malformed event wrote a row for %s", id)
		}
	}
}

func TestPruneRunsAtStartAndEvery500(t *testing.T) {
	h := newHarness(t, 1)
	staleAt := model.FormatISO(time.Now().Add(-48 * time.Hour))
	seedRawOp(t, h.ops, "stale-at-start", staleAt)

	h.wiring.Start()
	t.Cleanup(h.wiring.Stop)
	waitUntil(t, time.Second, func() bool { return !rowExists(t, h.ops, "stale-at-start") })

	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)

	seedRawOp(t, h.ops, "stale-at-500", staleAt)
	for i := 0; i < 500; i++ {
		h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload(fmt.Sprintf("op%d", i), "ok")}
	}
	waitUntil(t, 2*time.Second, func() bool { return updates.count() == 500 })
	waitUntil(t, time.Second, func() bool { return !rowExists(t, h.ops, "stale-at-500") })

	seedRawOp(t, h.ops, "stale-at-501", staleAt)
	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload("op500", "ok")}
	waitUntil(t, 2*time.Second, func() bool { return updates.count() == 501 })
	time.Sleep(100 * time.Millisecond) // give a hypothetical (buggy) third prune a moment to run
	if !rowExists(t, h.ops, "stale-at-501") {
		t.Errorf("a prune ran at op 501, want the next one only at op 1000")
	}
}

func TestEngineDownReconcilesInFlight(t *testing.T) {
	h := newHarness(t, 30)
	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)
	h.wiring.Start()

	startedAt := model.NowISO()
	for _, id := range []string{"op1", "op2", "op3"} {
		h.src.ch <- enginehost.Event{Topic: enginehost.EventOpStart, Payload: opStartPayload(id, nil, nil, "read", startedAt)}
	}
	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpStart, Payload: opStartPayload("op4", nil, nil, "read", startedAt)}
	h.src.ch <- enginehost.Event{Topic: enginehost.EventOpEnd, Payload: opEndPayload("op4", "ok")}
	waitUntil(t, time.Second, func() bool { return rowExists(t, h.ops, "op4") && fetchOp(t, h.ops, "op4").Status == "ok" })

	h.src.ch <- enginehost.Event{Topic: enginehost.EventEngineDown}

	for _, id := range []string{"op1", "op2", "op3"} {
		waitUntil(t, time.Second, func() bool { return fetchOp(t, h.ops, id).Status == "error" })
		row := fetchOp(t, h.ops, id)
		if row.Error == nil || *row.Error != "engine process exited" {
			t.Errorf("%s.Error = %v, want \"engine process exited\"", id, row.Error)
		}
		if row.DurationMs == nil || *row.DurationMs < 0 {
			t.Errorf("%s.DurationMs = %v, want a non-negative value", id, row.DurationMs)
		}
	}
	if row := fetchOp(t, h.ops, "op4"); row.Status != "ok" {
		t.Errorf("op4 (already finished before engine:down) status = %q, want untouched ok", row.Status)
	}

	// The goroutine's `for evt := range events` returns once the channel closes — Stop (via
	// fakeSource's unsubscribe) closing it here must not panic or hang.
	h.wiring.Stop()
}

func TestUnparseableStartedAtGivesZeroDuration(t *testing.T) {
	h := newHarness(t, 30)
	h.wiring.Start()
	t.Cleanup(h.wiring.Stop)

	h.src.ch <- enginehost.Event{
		Topic:   enginehost.EventOpStart,
		Payload: opStartPayload("op-bad-date", nil, nil, "read", "not a date"),
	}
	waitUntil(t, time.Second, func() bool { return rowExists(t, h.ops, "op-bad-date") })

	h.src.ch <- enginehost.Event{Topic: enginehost.EventEngineDown}
	waitUntil(t, time.Second, func() bool { return fetchOp(t, h.ops, "op-bad-date").Status == "error" })
	row := fetchOp(t, h.ops, "op-bad-date")
	if row.DurationMs == nil || *row.DurationMs != 0 {
		t.Errorf("DurationMs = %v, want 0", row.DurationMs)
	}
}

func TestRealHostEngineDown(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	host := enginetest.Host(t)
	w := oplog.New(host, r.Ops, 30)
	w.Start()
	t.Cleanup(w.Stop)

	if _, err := host.Call("fixture:emit-op-start", map[string]any{
		"opId": "real-op1", "connectionId": nil, "tabId": nil, "kind": "read", "startedAt": model.NowISO(),
	}); err != nil {
		t.Fatalf("fixture:emit-op-start: %v", err)
	}
	waitUntil(t, time.Second, func() bool { return rowExists(t, r.Ops, "real-op1") })

	_, _ = host.Call("fixture:crash", nil) // never answers; the engine process exits instead

	waitUntil(t, 2*time.Second, func() bool { return fetchOp(t, r.Ops, "real-op1").Status == "error" })
}
