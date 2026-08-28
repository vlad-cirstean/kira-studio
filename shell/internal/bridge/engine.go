package bridge

import "github.com/kirathecat/kira-studio/shell/internal/appcore"

// EngineStatus mirrors src/shared/protocol/ipc.ts's EngineStatus.
type EngineStatus struct {
	Alive bool `json:"alive"`
	PID   *int `json:"pid"`
}

type EngineService struct {
	Deps appcore.Deps
}

func (s *EngineService) Status() (EngineStatus, error) {
	if s.Deps.EngineHost == nil || !s.Deps.EngineHost.Alive() {
		return EngineStatus{Alive: false, PID: nil}, nil
	}
	pid := s.Deps.EngineHost.PID()
	return EngineStatus{Alive: true, PID: &pid}, nil
}
