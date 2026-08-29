package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type ConnectionsService struct {
	Deps appcore.Deps
}

func (s *ConnectionsService) List() ([]model.ConnectionSummary, error) {
	return s.Deps.Connections.List()
}

func (s *ConnectionsService) Create(input connections.Input) (model.ConnectionSummary, error) {
	return s.Deps.Connections.Create(input)
}

type ConnectionsUpdateArgs struct {
	ID    string            `json:"id"`
	Input connections.Input `json:"input"`
}

func (s *ConnectionsService) Update(args ConnectionsUpdateArgs) (model.ConnectionSummary, error) {
	return s.Deps.Connections.Update(args.ID, args.Input)
}

// ConnectionsIDArgs is shared by every method below that needs nothing but a connection id.
type ConnectionsIDArgs struct {
	ID string `json:"id"`
}

func (s *ConnectionsService) Duplicate(args ConnectionsIDArgs) (model.ConnectionSummary, error) {
	return s.Deps.Connections.Duplicate(args.ID)
}

func (s *ConnectionsService) Remove(args ConnectionsIDArgs) error {
	return s.Deps.Connections.Remove(args.ID)
}

type ConnectionsReorderArgs struct {
	IDs []string `json:"ids"`
}

func (s *ConnectionsService) Reorder(args ConnectionsReorderArgs) ([]model.ConnectionSummary, error) {
	return s.Deps.Connections.Reorder(args.IDs)
}

// Reveal never errors (P25 D9) — an undecryptable secret comes back as a RevealResult carrying
// its own Error field, not a rejected call.
func (s *ConnectionsService) Reveal(args ConnectionsIDArgs) connections.RevealResult {
	return s.Deps.Connections.Reveal(args.ID)
}

// Test never errors, for the same reason: failure is reported inside TestResult.
func (s *ConnectionsService) Test(input connections.Input) connections.TestResult {
	return s.Deps.Connections.Test(input)
}

func (s *ConnectionsService) Connect(args ConnectionsIDArgs) (model.ConnectionState, error) {
	return s.Deps.Connections.Connect(args.ID)
}

func (s *ConnectionsService) Disconnect(args ConnectionsIDArgs) (model.ConnectionState, error) {
	return s.Deps.Connections.Disconnect(args.ID)
}

// States is in-memory, not DB-backed (mirrors src/main/connections.ts's own `states` Map),
// sorted by connection id (P55 §2 D7).
func (s *ConnectionsService) States() ([]model.ConnectionState, error) {
	return s.Deps.Connections.States(), nil
}

// SecretStorageStatus mirrors src/shared/domain/secrets.ts's secretStorageStatusSchema.
type SecretStorageStatus struct {
	Available        bool    `json:"available"`
	Backend          string  `json:"backend"`
	InsecureFallback bool    `json:"insecureFallback"`
	Reason           *string `json:"reason"`
}

// SecretsStatus reports the real Keychain-backed cipher's status (P55 M1). secrets.Status and
// SecretStorageStatus are field-for-field identical (that struct moved to internal/secrets
// unchanged, per P55 §1.3) so a plain conversion is exact, not a coincidental shortcut.
func (s *ConnectionsService) SecretsStatus() (SecretStorageStatus, error) {
	return SecretStorageStatus(s.Deps.Connections.SecretsStatus()), nil
}
