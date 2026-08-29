package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type OpsService struct {
	Deps appcore.Deps
}

type OpsRecentArgs struct {
	Limit int `json:"limit"`
}

func (s *OpsService) Recent(args OpsRecentArgs) ([]model.OpRecord, error) {
	if args.Limit <= 0 {
		return nil, ipcerr.BadRequest("limit must be positive")
	}
	recs, err := s.Deps.Repos.Ops.Recent(args.Limit)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return recs, nil
}
