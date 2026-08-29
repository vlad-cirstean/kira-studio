package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type LayoutService struct {
	Deps appcore.Deps
}

func (s *LayoutService) GetAll() (model.Layout, error) {
	layout, err := s.Deps.Repos.Layout.GetAll()
	if err != nil {
		return model.Layout{}, ipcerr.Internal(err.Error())
	}
	return layout, nil
}
