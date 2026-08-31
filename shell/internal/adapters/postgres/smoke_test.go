package postgres_test

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/postgres"
	"github.com/kirathecat/kira-studio/shell/internal/adapters/testsupport"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// TestSmoke_ConnectListDatabasesDisconnect is a throwaway harness check, not part of §5.3/§5.4's
// numbered acceptance cases: it exists to validate testsupport.StartPostgres end to end (real
// container, real seed) against the real adapter before the full spec is ported.
func TestSmoke_ConnectListDatabasesDisconnect(t *testing.T) {
	fixture := testsupport.StartPostgres(t)

	adapter, err := adapters.CreateAdapter("postgres", adapters.Deps{Log: func(level, msg string) { t.Logf("[%s] %s", level, msg) }})
	if err != nil {
		t.Fatalf("CreateAdapter: %v", err)
	}

	ctx := context.Background()
	op := adapters.NewOpCtx("smoke-connect")
	info, err := adapter.Connect(ctx, fixture.Config, op)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if info.ServerVersion == "" {
		t.Error("expected a non-empty server version")
	}
	t.Logf("connected: %+v", info)

	children, err := adapter.Children(ctx, model.NodePath{ConnectionID: fixture.Config.ID}, op)
	if err != nil {
		t.Fatalf("Children (root): %v", err)
	}
	names := make([]string, len(children.Nodes))
	for i, n := range children.Nodes {
		names[i] = n.Name
	}
	t.Logf("databases: %v", names)
	if len(children.Nodes) == 0 {
		t.Error("expected at least one database")
	}

	if err := adapter.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
}
