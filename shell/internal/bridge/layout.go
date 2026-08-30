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

type LayoutSetArgs struct {
	Patch model.LayoutPatch `json:"patch"`
}

func (s *LayoutService) Set(args LayoutSetArgs) (model.Layout, error) {
	merged, err := s.Deps.Repos.Layout.Set(args.Patch)
	if err != nil {
		return model.Layout{}, ipcerr.Internal(err.Error())
	}
	return merged, nil
}
