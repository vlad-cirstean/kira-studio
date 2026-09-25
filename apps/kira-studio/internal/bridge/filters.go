package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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
	return ipcerr.InternalResult(s.Deps.Repos.Filters.List(args.ConnectionID))
}

type FiltersReplaceArgs struct {
	ConnectionID string               `json:"connectionId"`
	Visibility   model.TreeVisibility `json:"visibility"`
}

func (s *FiltersService) Replace(args FiltersReplaceArgs) (model.TreeVisibility, error) {
	if args.ConnectionID == "" {
		return model.TreeVisibility{}, ipcerr.BadRequest("connectionId is required")
	}
	return ipcerr.InternalResult(s.Deps.Repos.Filters.Replace(args.ConnectionID, args.Visibility))
}
