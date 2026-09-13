package bridge

import (
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
)

// EngineStatus mirrors packages/shared/protocol/ipc.ts's EngineStatus.
type EngineStatus struct {
	Alive bool `json:"alive"`
	PID   *int `json:"pid"`
}

type EngineService struct {
	Deps appcore.Deps
}

// Status has zero renderer callers (§1.9: the status pill reads the data-plane ping, not this) but
// stays bound — deleting it means regenerating bindings and editing control.ts for no user-visible
// gain. It reports unconditionally now: the engine is this process (P58f D11).
func (s *EngineService) Status() (EngineStatus, error) {
	pid := os.Getpid()
	return EngineStatus{Alive: true, PID: &pid}, nil
}
