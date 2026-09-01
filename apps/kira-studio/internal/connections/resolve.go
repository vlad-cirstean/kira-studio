package connections

import (
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// resolved is resolve's and resolveFromInput's shared return shape: the engine-bound config plus
// the two preconnect fields stripped from it, which only doConnect needs.
type resolved struct {
	config            model.ResolvedConnectionConfig
	preconnect        *string
	preconnectSidecar bool
}

// resolve reads the row, reads the secret through SecretsRepo.Get, and injects the password into
// URI when URI is non-nil. Never returned over IPC (D9 — the engine channel is the only consumer).
func resolve(conns *repos.ConnectionsRepo, secrets *repos.SecretsRepo, id string) (resolved, error) {
	summary, err := conns.Get(id)
	if err != nil {
		return resolved{}, fmt.Errorf("connections: resolve %s: %w", id, err)
	}
	if summary == nil {
		return resolved{}, fmt.Errorf("connection %s not found", id)
	}
	password, err := secrets.Get(id)
	if err != nil {
		return resolved{}, fmt.Errorf("connections: resolve %s: %w", id, err)
	}

	uri := summary.URI
	if uri != nil {
		injected := injectURIPassword(*uri, password)
		uri = &injected
	}

	return resolved{
		config: model.ResolvedConnectionConfig{
			ID: summary.ID, Name: summary.Name, Kind: summary.Kind, Color: summary.Color,
			Mode: summary.Mode, ReadOnly: summary.ReadOnly, Host: summary.Host, Port: summary.Port,
			Database: summary.Database, Username: summary.Username, URI: uri, Options: summary.Options,
			SortOrder: summary.SortOrder, CreatedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt,
			Password: password,
		},
		preconnect:        summary.Preconnect,
		preconnectSidecar: summary.PreconnectSidecar,
	}, nil
}

// resolveFromInput builds the same shape as resolve, but from an unsaved draft (the dialog's
// "Test connection" button tests the input as typed, not what is on disk) — connections.ts:146's
// literals `id: 'test'`, `sortOrder: 0`, empty timestamps, and the reason Test's preconnect entry
// is keyed on "test".
func resolveFromInput(in Input) resolved {
	uri := in.URI
	password := in.Password
	if uri != nil {
		// P2 R2: a password typed directly into the URI's own userinfo is the freshest signal of
		// what the user actually wants tested — mirrors Create/Update's own rule below. Without
		// this, retyping the whole URI for a different host with its own new inline credentials
		// still silently tested with in.Password, a stale echo of whatever this connection's
		// secret happened to be before the edit (nil for a brand-new draft, so this only bit an
		// edit in progress).
		if _, pw := stripURIPassword(*uri); pw != nil {
			password = pw
		}
		injected := injectURIPassword(*uri, password)
		uri = &injected
	}
	return resolved{
		config: model.ResolvedConnectionConfig{
			ID: "test", Name: in.Name, Kind: in.Kind, Color: in.Color, Mode: in.Mode,
			ReadOnly: in.ReadOnly, Host: in.Host, Port: in.Port, Database: in.Database,
			Username: in.Username, URI: uri, Options: in.Options,
			SortOrder: 0, CreatedAt: "", UpdatedAt: "",
			Password: password,
		},
		preconnect:        in.Preconnect,
		preconnectSidecar: in.PreconnectSidecar,
	}
}
