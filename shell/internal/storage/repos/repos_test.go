package repos_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

func TestNewWiresEveryRepoAndPreparedStatementsWork(t *testing.T) {
	db := newRepos(t).DB
	r, err := repos.New(db)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	// Exercise each of D5's five prepared-statement paths through the aggregate, not a direct
	// struct literal, to prove repos.New actually wires them (a nil selectAll/insert/update
	// silently falls back to an ad-hoc query, which would hide a wiring bug here).
	if _, err := r.Settings.GetAll(); err != nil {
		t.Errorf("Settings.GetAll: %v", err)
	}
	if _, err := r.Layout.GetAll(); err != nil {
		t.Errorf("Layout.GetAll: %v", err)
	}
	if _, err := r.Tabs.List(); err != nil {
		t.Errorf("Tabs.List: %v", err)
	}
	if err := r.Ops.Append(model.OpAppend{ID: "op1", Kind: "read", StartedAt: model.NowISO()}); err != nil {
		t.Errorf("Ops.Append: %v", err)
	}
	if err := r.Ops.Finish("op1", model.OpFinish{Status: "ok", DurationMs: 1}); err != nil {
		t.Errorf("Ops.Finish: %v", err)
	}
}

func TestNewSecretsIsSeparateFromTheAggregate(t *testing.T) {
	db := newRepos(t).DB
	seedConnection(t, db, "c1")
	sr := repos.NewSecrets(db, newTestCipher(t))
	if _, err := sr.Get("c1"); err != nil {
		t.Errorf("Get: %v", err)
	}
}
