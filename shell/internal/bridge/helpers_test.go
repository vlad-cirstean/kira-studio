package bridge_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// newTestDeps opens a real (tmpfile-backed) SQLite database through the real migrations and
// returns Deps wired with Repos and a recordingEmitter for Events — everything the settings/
// layout/filters/queries services need that doesn't touch the engine.
func newTestDeps(t *testing.T) (appcore.Deps, *repos.Repos, *recordingEmitter) {
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

	rec := &recordingEmitter{}
	return appcore.Deps{Repos: r, Events: rec}, r, rec
}

// newTestDepsWithHost is newTestDeps plus a real enginetest.Host, for services that call the
// engine (OpsService.Cancel, SettingsService.Set's cache re-push).
func newTestDepsWithHost(t *testing.T) (appcore.Deps, *repos.Repos, *enginehost.Host) {
	t.Helper()
	deps, r, _ := newTestDeps(t)
	host := enginetest.Host(t)
	deps.EngineHost = host
	return deps, r, host
}

// seedConnectionRow inserts a bare connections row so a saved_queries/filter_history/op_log
// foreign key holds.
func seedConnectionRow(t *testing.T, r *repos.Repos, connID string) {
	t.Helper()
	fields := model.ConnectionFields{
		Name: connID, Kind: "postgres", Color: "blue", Mode: "fields", Options: map[string]any{},
	}
	if _, err := r.Connections.Insert(connID, fields, "2026-01-01T00:00:00.000Z"); err != nil {
		t.Fatalf("seed connection %s: %v", connID, err)
	}
}
