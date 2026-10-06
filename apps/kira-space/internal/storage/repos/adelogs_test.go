package repos

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func TestAdeLogsRepo_PurgeArchived(t *testing.T) {
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	tasks := &AdeTaskRepo{DB: db.DB}
	logs := &AdeLogsRepo{DB: db.DB}

	const cutoff = int64(1_000_000_000_000)
	for id, archivedAt := range map[string]int64{"A": cutoff, "B": cutoff + 1, "C": 0} {
		if _, err := tasks.CreateTask(model.AdeTask{ID: id, Kind: model.AdeTaskKindTask, Title: id, CreatedAt: 1}, nil); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
		if archivedAt != 0 {
			if err := tasks.ArchiveTask(id, archivedAt); err != nil {
				t.Fatalf("archive %s: %v", id, err)
			}
		}
		for kind, logID := range map[string]string{AdeLogRun: "run-" + id, AdeLogSetup: "br-" + id} {
			if err := logs.Reset(kind, logID, id); err != nil {
				t.Fatalf("reset %s: %v", logID, err)
			}
			if _, err := logs.Append(kind, logID, []AdeLogChunk{{At: 1, Stream: "stdout", Text: "x"}}); err != nil {
				t.Fatalf("append %s: %v", logID, err)
			}
		}
	}
	if err := tasks.InsertRun(model.AdeRun{ID: "run-A", TaskID: "A", Attempt: 1, State: model.AdeRunDone}); err != nil {
		t.Fatalf("insert run: %v", err)
	}

	count := func(q string) int {
		var n int
		if err := db.DB.QueryRow(q).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	purge := func(at int64, want int) {
		t.Helper()
		n, err := logs.PurgeArchived(at)
		if err != nil || n != want {
			t.Fatalf("PurgeArchived(%d) = %d, %v; want %d", at, n, err, want)
		}
	}

	purge(cutoff, 2)
	if n := count(`SELECT COUNT(*) FROM ade_logs WHERE task_id = 'A'`); n != 0 {
		t.Fatalf("A logs = %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM ade_log_chunks WHERE id IN ('run-A','br-A')`); n != 0 {
		t.Fatalf("A chunks = %d, cascade missed", n)
	}
	if got, err := tasks.GetTask("A"); err != nil || got.ArchivedAt == nil {
		t.Fatalf("task A = %+v, %v; want kept archived", got, err)
	}
	if _, err := tasks.GetRun("run-A"); err != nil {
		t.Fatalf("run A: %v", err)
	}
	for _, c := range []struct{ kind, id string }{{AdeLogRun, "run-B"}, {AdeLogSetup, "br-C"}} {
		if p, err := logs.Page(c.kind, c.id, 0); err != nil || len(p.Chunks) != 1 {
			t.Fatalf("page %s = %+v, %v; want 1 chunk", c.id, p, err)
		}
	}

	purge(cutoff, 0)
	purge(cutoff+1, 2)
	if p, err := logs.Page(AdeLogRun, "run-C", 0); err != nil || len(p.Chunks) != 1 {
		t.Fatalf("live task log = %+v, %v", p, err)
	}
}
