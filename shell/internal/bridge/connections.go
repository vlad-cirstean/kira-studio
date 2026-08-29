package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type ConnectionsService struct {
	Deps appcore.Deps
}

func (s *ConnectionsService) List() ([]model.ConnectionSummary, error) {
	list, err := s.Deps.Repos.Connections.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

// States is in-memory, not DB-backed (mirrors src/main/connections.ts's own `states` Map) — the
// full connect/disconnect state machine lands in P55. A fresh boot with nothing connected yet has
// nothing to report, matching today's behaviour before any connect attempt.
func (s *ConnectionsService) States() ([]model.ConnectionState, error) {
	return []model.ConnectionState{}, nil
}

// SecretStorageStatus mirrors src/shared/domain/secrets.ts's secretStorageStatusSchema.
type SecretStorageStatus struct {
	Available        bool    `json:"available"`
	Backend          string  `json:"backend"`
	InsecureFallback bool    `json:"insecureFallback"`
	Reason           *string `json:"reason"`
}

// SecretsStatus is a real answer, not a stub: the Keychain-backed cipher (P51 §3.5, resolved in
// P52 §6) is P55 work, so until then this build honestly reports itself as unavailable rather
// than claiming a backend it does not have — the same `{available:false, backend:'unavailable'}`
// shape src/main/secret-cipher.ts already reports on a real probe failure (P25 D13), which the
// connection dialog already renders correctly.
func (s *ConnectionsService) SecretsStatus() (SecretStorageStatus, error) {
	reason := "Secret storage is not implemented in this build yet (P52 walking skeleton; lands in P55)."
	return SecretStorageStatus{
		Available:        false,
		Backend:          "unavailable",
		InsecureFallback: false,
		Reason:           &reason,
	}, nil
}
