package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

type LayoutService struct {
	Deps appcore.Deps
}

func (s *LayoutService) GetAll() (repos.Layout, error) {
	layout, err := s.Deps.Layout.GetAll()
	if err != nil {
		return repos.Layout{}, ipcerr.Internal(err.Error())
	}
	return layout, nil
}
