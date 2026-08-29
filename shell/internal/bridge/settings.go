package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type SettingsService struct {
	Deps appcore.Deps
}

func (s *SettingsService) GetAll() (model.Settings, error) {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		return model.Settings{}, ipcerr.Internal(err.Error())
	}
	return settings, nil
}
