package repos

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// A repository mid-backfill has all sync times 0 but fresh writes; PruneIdle must keep it.
func TestGitHostChangeRequestsRepo_PruneIdleKeepsActiveBackfill(t *testing.T) {
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := &GitHostChangeRequestsRepo{DB: db.DB}

	if err := repo.PutSyncState("b", model.GitHostSyncState{Account: "a", BackfillCursor: "c1"}); err != nil {
		t.Fatalf("put b: %v", err)
	}
	if err := repo.PutSyncState("c", model.GitHostSyncState{Account: "a"}); err != nil {
		t.Fatalf("put c: %v", err)
	}
	if err := repo.PruneIdle(time.Now().Add(-time.Hour).UnixMilli(), "c"); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, have, _ := repo.SyncState("b"); !have {
		t.Fatal("active backfill state pruned")
	}
	if err := repo.PruneIdle(time.Now().Add(time.Hour).UnixMilli(), "c"); err != nil {
		t.Fatalf("prune idle: %v", err)
	}
	if _, have, _ := repo.SyncState("b"); have {
		t.Fatal("idle state kept")
	}
	if _, have, _ := repo.SyncState("c"); !have {
		t.Fatal("keep repo pruned")
	}
}
