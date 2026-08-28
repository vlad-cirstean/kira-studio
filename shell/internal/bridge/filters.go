package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

type FiltersService struct {
	Deps appcore.Deps
}

type FiltersListArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *FiltersService) List(args FiltersListArgs) (repos.TreeVisibility, error) {
	if args.ConnectionID == "" {
		return repos.TreeVisibility{}, ipcerr.BadRequest("connectionId is required")
	}
	vis, err := s.Deps.Filters.List(args.ConnectionID)
	if err != nil {
		return repos.TreeVisibility{}, ipcerr.Internal(err.Error())
	}
	return vis, nil
}
