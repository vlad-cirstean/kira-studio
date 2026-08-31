package oplog_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/oplog"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// fakeSource is an EventSource a test drives directly, without a real engine child.
type fakeSource struct {
	ch chan oplog.Event
}

func newFakeSource() *fakeSource {
	return &fakeSource{ch: make(chan oplog.Event, 1024)}
}

func (f *fakeSource) Subscribe() (<-chan oplog.Event, func()) {
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

// TestPruneRunsAtStartAndEvery500 pins the prune cadence's counter arithmetic: once at Start, then
// on exactly the 500th completed op and not again until the 1000th. An off-by-one here either
// prunes on every op (a full table scan per query) or never prunes at all after startup.
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
		h.src.ch <- oplog.Event{Topic: oplog.EventOpEnd, Payload: opEndPayload(fmt.Sprintf("op%d", i), "ok")}
	}
	waitUntil(t, 2*time.Second, func() bool { return updates.count() == 500 })
	waitUntil(t, time.Second, func() bool { return !rowExists(t, h.ops, "stale-at-500") })

	seedRawOp(t, h.ops, "stale-at-501", staleAt)
	h.src.ch <- oplog.Event{Topic: oplog.EventOpEnd, Payload: opEndPayload("op500", "ok")}
	waitUntil(t, 2*time.Second, func() bool { return updates.count() == 501 })
	time.Sleep(100 * time.Millisecond) // give a hypothetical (buggy) third prune a moment to run
	if !rowExists(t, h.ops, "stale-at-501") {
		t.Errorf("a prune ran at op 501, want the next one only at op 1000")
	}
}

// TestShutdownReconcilesInFlight covers this package's actual subject: everything still tracked as
// running when the event channel closes must be finished with the shutdown error and dropped from
// the in-flight map, while an op that already reached a terminal state is left alone. Closing the
// channel is what Stop (main's before-quit, via fakeSource's unsubscribe) does in production too
// (P58f D9) — there is no separate synthetic "engine died" event to send any more.
func TestShutdownReconcilesInFlight(t *testing.T) {
	h := newHarness(t, 30)
	var updates updateCollector
	h.wiring.OnUpdate(updates.handle)
	h.wiring.Start()

	startedAt := model.NowISO()
	for _, id := range []string{"op1", "op2", "op3"} {
		h.src.ch <- oplog.Event{Topic: oplog.EventOpStart, Payload: opStartPayload(id, nil, nil, "read", startedAt)}
	}
	h.src.ch <- oplog.Event{Topic: oplog.EventOpStart, Payload: opStartPayload("op4", nil, nil, "read", startedAt)}
	h.src.ch <- oplog.Event{Topic: oplog.EventOpEnd, Payload: opEndPayload("op4", "ok")}
	waitUntil(t, time.Second, func() bool { return rowExists(t, h.ops, "op4") && fetchOp(t, h.ops, "op4").Status == "ok" })

	// Stop's unsubscribe closes the channel; consume's range loop returns and finishInFlight runs.
	// Must not panic or hang.
	h.wiring.Stop()

	for _, id := range []string{"op1", "op2", "op3"} {
		waitUntil(t, time.Second, func() bool { return fetchOp(t, h.ops, id).Status == "error" })
		row := fetchOp(t, h.ops, id)
		if row.Error == nil || *row.Error != "app exited" {
			t.Errorf("%s.Error = %v, want \"app exited\"", id, row.Error)
		}
		if row.DurationMs == nil || *row.DurationMs < 0 {
			t.Errorf("%s.DurationMs = %v, want a non-negative value", id, row.DurationMs)
		}
	}
	if row := fetchOp(t, h.ops, "op4"); row.Status != "ok" {
		t.Errorf("op4 (already finished before shutdown) status = %q, want untouched ok", row.Status)
	}
}
