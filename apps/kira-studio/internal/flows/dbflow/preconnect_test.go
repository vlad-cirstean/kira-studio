package dbflow

import (
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func opUpdates(app *flowharness.App, mark int) []model.OpRecord {
	var out []model.OpRecord
	for _, ev := range app.Events.Since(mark, bridge.ChannelOpUpdate) {
		if rec, ok := ev.Data.(model.OpRecord); ok {
			out = append(out, rec)
		}
	}
	return out
}

// waitOp blocks until an op update of kind and status arrives after mark; the op log consumes
// op events asynchronously, so they can land after Connect returns.
func waitOp(t *testing.T, app *flowharness.App, mark int, kind, status string) {
	t.Helper()
	app.Events.WaitAfter(t, mark, bridge.ChannelOpUpdate, func(ev flowharness.Event) bool {
		rec, ok := ev.Data.(model.OpRecord)
		return ok && rec.Kind == kind && rec.Status == status
	}, 5*time.Second)
}

func indexOf(recs []model.OpRecord, kind, status string) int {
	for i, r := range recs {
		if r.Kind == kind && r.Status == status {
			return i
		}
	}
	return -1
}

func TestSQLitePreconnectOp(t *testing.T) {
	t.Run("script shows as an op that ends before connect starts", func(t *testing.T) {
		app := flowharness.New(t)
		in := sqliteInput("tunnel", newSQLiteFile(t))
		in.Preconnect = ptr("sleep 0.3")
		conn := createConn(t, app, in)

		mark := app.Events.Mark()
		if st := connect(t, app, conn.ID); st.Status != "connected" {
			t.Fatalf("Connect = %+v, want connected", st)
		}

		waitOp(t, app, mark, "preconnect", "ok")
		waitOp(t, app, mark, "connect", "ok")
		recs := opUpdates(app, mark)
		running, done, connectRunning := indexOf(recs, "preconnect", "running"), indexOf(recs, "preconnect", "ok"), indexOf(recs, "connect", "running")
		if running < 0 || done < 0 || connectRunning < 0 {
			t.Fatalf("op updates = %+v, want preconnect running+ok and connect running", recs)
		}
		if done > connectRunning {
			t.Errorf("preconnect finished at update %d, after connect started at %d", done, connectRunning)
		}
		pre := recs[done]
		if pre.ConnectionID == nil || *pre.ConnectionID != conn.ID {
			t.Errorf("preconnect connectionId = %v, want %s", pre.ConnectionID, conn.ID)
		}
		if pre.Command == nil || *pre.Command != "sleep 0.3" {
			t.Errorf("preconnect command = %v, want the script text", pre.Command)
		}
		if pre.DurationMs == nil || *pre.DurationMs < 300 {
			t.Errorf("preconnect durationMs = %v, want >= 300", pre.DurationMs)
		}

		mask := flowharness.Mask("id", "durationMs")
		app.Contract(t, "preconnect-op", "event:preconnect-running", recs[running], mask)
		app.Contract(t, "preconnect-op", "event:preconnect-ok", pre, mask)
	})

	t.Run("failing script errors the connection with no connect op", func(t *testing.T) {
		app := flowharness.New(t)
		in := sqliteInput("broken", newSQLiteFile(t))
		in.Preconnect = ptr("echo boom >&2; exit 3")
		conn := createConn(t, app, in)

		mark := app.Events.Mark()
		st, _ := app.W.Connections.Connect(bridge.ConnectionsIDArgs{ID: conn.ID})
		if st.Status != "error" {
			t.Fatalf("Connect state = %+v, want error", st)
		}

		waitOp(t, app, mark, "preconnect", "error")
		recs := opUpdates(app, mark)
		pre := recs[indexOf(recs, "preconnect", "error")]
		if pre.Error == nil || !strings.Contains(*pre.Error, "boom") {
			t.Errorf("preconnect error = %v, want it to carry the script's stderr", pre.Error)
		}
		for _, r := range recs {
			if r.Kind == "connect" {
				t.Errorf("connect op %+v ran after a failed pre-connect script", r)
			}
		}
	})
}
