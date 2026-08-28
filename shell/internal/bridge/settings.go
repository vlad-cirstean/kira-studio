package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

type SettingsService struct {
	Deps appcore.Deps
}

func (s *SettingsService) GetAll() (repos.Settings, error) {
	settings, err := s.Deps.Settings.GetAll()
	if err != nil {
		return repos.Settings{}, ipcerr.Internal(err.Error())
	}
	return settings, nil
}
