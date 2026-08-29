package repos_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestOpsAppendThenRecent(t *testing.T) {
	r := newOpsRepo(t)
	if err := r.Append(model.OpAppend{ID: "op1", Kind: "read", StartedAt: model.NowISO()}); err != nil {
		t.Fatalf("Append: %v", err)
	}
	recs, err := r.Recent(10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("Recent() len = %d, want 1", len(recs))
	}
	rec := recs[0]
	if rec.Status != "running" || rec.DurationMs != nil || rec.Rows != nil {
		t.Errorf("Recent() after Append = %+v, want status=running, duration/rows nil", rec)
	}
}

func TestOpsFinishThenRecent(t *testing.T) {
	r := newOpsRepo(t)
	if err := r.Append(model.OpAppend{ID: "op1", Kind: "read", StartedAt: model.NowISO()}); err != nil {
		t.Fatalf("Append: %v", err)
	}
	rows := 42
	if err := r.Finish("op1", model.OpFinish{Status: "ok", DurationMs: 123, Rows: &rows}); err != nil {
		t.Fatalf("Finish: %v", err)
	}
	recs, err := r.Recent(10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recs) != 1 || recs[0].Status != "ok" || recs[0].DurationMs == nil || *recs[0].DurationMs != 123 {
		t.Fatalf("Recent() after Finish = %+v", recs)
	}
}

func TestOpsRecentLimitAndOrdering(t *testing.T) {
	r := newOpsRepo(t)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i, id := range []string{"a", "b", "c"} {
		ts := model.FormatISO(base.Add(time.Duration(i) * time.Minute))
		if err := r.Append(model.OpAppend{ID: id, Kind: "read", StartedAt: ts}); err != nil {
			t.Fatalf("Append %s: %v", id, err)
		}
	}
	recs, err := r.Recent(2)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recs) != 2 {
		t.Fatalf("Recent(2) len = %d, want 2", len(recs))
	}
	if recs[0].ID != "c" || recs[1].ID != "b" {
		t.Errorf("Recent(2) order = [%s, %s], want [c, b] (newest first)", recs[0].ID, recs[1].ID)
	}
}

func TestOpsRecentDropsBadRows(t *testing.T) {
	tests := []struct {
		name   string
		kind   string
		status string
	}{
		{"legacy ddl kind is not coerced, just dropped", "ddl", "ok"},
		{"unknown kind", "banana", "ok"},
		{"unknown status", "read", "weird"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newOpsRepo(t)
			if _, err := r.DB.Exec(
				`INSERT INTO op_log (id, started_at, kind, status) VALUES ('x', ?, ?, ?)`,
				model.NowISO(), tt.kind, tt.status,
			); err != nil {
				t.Fatalf("seed: %v", err)
			}
			recs, err := r.Recent(10)
			if err != nil {
				t.Fatalf("Recent: %v", err)
			}
			if len(recs) != 0 {
				t.Errorf("Recent() = %+v, want empty (row should be dropped)", recs)
			}
		})
	}
}

func TestOpsPruneRetentionCut(t *testing.T) {
	r := newOpsRepo(t)
	now := time.Now().UTC()
	old := model.FormatISO(now.Add(-40 * 24 * time.Hour))
	recent := model.FormatISO(now.Add(-1 * 24 * time.Hour))
	if _, err := r.DB.Exec(`INSERT INTO op_log (id, started_at, kind, status) VALUES ('old', ?, 'read', 'ok')`, old); err != nil {
		t.Fatalf("seed old: %v", err)
	}
	if _, err := r.DB.Exec(`INSERT INTO op_log (id, started_at, kind, status) VALUES ('recent', ?, 'read', 'ok')`, recent); err != nil {
		t.Fatalf("seed recent: %v", err)
	}

	if err := r.Prune(30); err != nil {
		t.Fatalf("Prune: %v", err)
	}
	recs, err := r.Recent(10)
	if err != nil {
		t.Fatalf("Recent: %v", err)
	}
	if len(recs) != 1 || recs[0].ID != "recent" {
		t.Fatalf("Recent() after Prune(30) = %+v, want only 'recent'", recs)
	}
}

func TestOpsPruneHardCap(t *testing.T) {
	r := newOpsRepo(t)
	tx, err := r.DB.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO op_log (id, started_at, kind, status) VALUES (?, ?, 'read', 'ok')`)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	const total = 20_050
	for i := 0; i < total; i++ {
		ts := model.FormatISO(base.Add(time.Duration(i) * time.Second))
		if _, err := stmt.Exec(idFor(i), ts); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	_ = stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if err := r.Prune(3650); err != nil { // retention cut set wide enough to not interfere here
		t.Fatalf("Prune: %v", err)
	}

	var count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM op_log`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 20_000 {
		t.Fatalf("op_log row count after Prune = %d, want 20000", count)
	}

	// The newest row (highest index, latest started_at) must have survived.
	var exists int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM op_log WHERE id = ?`, idFor(total-1)).Scan(&exists); err != nil {
		t.Fatalf("check newest survived: %v", err)
	}
	if exists != 1 {
		t.Error("the newest row did not survive Prune's hard cap")
	}
}

func TestOpsPruneOnEmptyTableIsNoOp(t *testing.T) {
	r := newOpsRepo(t)
	if err := r.Prune(30); err != nil {
		t.Fatalf("Prune on empty table: %v", err)
	}
}

func idFor(i int) string {
	return fmt.Sprintf("op-%d", i)
}
