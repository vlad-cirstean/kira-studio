package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type FiltersService struct {
	Deps appcore.Deps
}

type FiltersListArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *FiltersService) List(args FiltersListArgs) (model.TreeVisibility, error) {
	if args.ConnectionID == "" {
		return model.TreeVisibility{}, ipcerr.BadRequest("connectionId is required")
	}
	vis, err := s.Deps.Repos.Filters.List(args.ConnectionID)
	if err != nil {
		return model.TreeVisibility{}, ipcerr.Internal(err.Error())
	}
	return vis, nil
}

type FiltersReplaceArgs struct {
	ConnectionID string               `json:"connectionId"`
	Visibility   model.TreeVisibility `json:"visibility"`
}

func (s *FiltersService) Replace(args FiltersReplaceArgs) (model.TreeVisibility, error) {
	if args.ConnectionID == "" {
		return model.TreeVisibility{}, ipcerr.BadRequest("connectionId is required")
	}
	vis, err := s.Deps.Repos.Filters.Replace(args.ConnectionID, args.Visibility)
	if err != nil {
		return model.TreeVisibility{}, ipcerr.Internal(err.Error())
	}
	return vis, nil
}
