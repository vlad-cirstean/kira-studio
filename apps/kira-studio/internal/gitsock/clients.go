package gitsock

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// TrustStore is what gitsock needs from the git_clients table (D6/D7): a lookup for the handshake,
// an upsert on approval (G12 D3: a revoked client's re-approval must clear revoked_at, not fail a
// UNIQUE insert), a touch on every successful reconnect, and a revoke. Declared here as an
// interface, satisfied structurally by *repos.GitClientsRepo, which main.go wires in directly —
// Go's exact-signature interface satisfaction is why this uses repos.GitClientRow/model.GitClient
// rather than a locally duplicated row type: a duplicate would need its own adapter to ever be
// satisfied by the real repo.
type TrustStore interface {
	ByID(id string) (repos.GitClientRow, bool, error)
	UpsertOnPair(row repos.GitClientRow) error
	TouchLastSeen(id string, now int64) error
	Revoke(id string, now int64) error
	List() ([]model.GitClient, error)
}
