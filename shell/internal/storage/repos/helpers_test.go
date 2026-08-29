package repos_test

import (
	"database/sql"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// newRepos opens a real (tmpfile-backed) SQLite database through the real migrations — going
// through storage.Open() rather than hand-restating the schema is what makes every migration
// covered on every test run (P52 §13).
func newRepos(t *testing.T) *storage.DB {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func newSettingsRepo(t *testing.T) *repos.SettingsRepo {
	return &repos.SettingsRepo{DB: newRepos(t).DB}
}

func newLayoutRepo(t *testing.T) *repos.LayoutRepo {
	return &repos.LayoutRepo{DB: newRepos(t).DB}
}

func newTabsRepo(t *testing.T) *repos.TabsRepo {
	return &repos.TabsRepo{DB: newRepos(t).DB}
}

func newConnectionsRepo(t *testing.T) *repos.ConnectionsRepo {
	return &repos.ConnectionsRepo{DB: newRepos(t).DB}
}

func newOpsRepo(t *testing.T) *repos.OpsRepo {
	return &repos.OpsRepo{DB: newRepos(t).DB}
}

func newFiltersRepo(t *testing.T) *repos.FiltersRepo {
	return &repos.FiltersRepo{DB: newRepos(t).DB}
}

func newSavedQueriesRepo(t *testing.T) *repos.SavedQueriesRepo {
	return &repos.SavedQueriesRepo{DB: newRepos(t).DB}
}

func newFilterHistoryRepo(t *testing.T) *repos.FilterHistoryRepo {
	return &repos.FilterHistoryRepo{DB: newRepos(t).DB}
}

func newMetadataCacheRepo(t *testing.T) *repos.MetadataCacheRepo {
	return &repos.MetadataCacheRepo{DB: newRepos(t).DB}
}

// seedConnection inserts a minimal connections row so a test can reference connID from a table
// with a foreign key into connections(id) — foreign_keys=ON (P52 §4.3) enforces this for real.
func seedConnection(t *testing.T, db *sql.DB, connID string) {
	t.Helper()
	now := model.NowISO()
	if _, err := db.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES (?, ?, 'postgres', 'blue', 'fields', 0, ?, ?, 0)`,
		connID, connID, now, now,
	); err != nil {
		t.Fatalf("seedConnection(%s): %v", connID, err)
	}
}
