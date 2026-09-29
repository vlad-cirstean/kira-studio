package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// OpsService serves the in-memory op log. Arg and result shapes match Kira Studio's OpsService,
// so the shared OpLogControl fits both.
type OpsService struct {
	Log *oplog.Log
}

type OpsRecentArgs struct {
	Limit int `json:"limit"`
}

func (s *OpsService) Recent(args OpsRecentArgs) ([]oplog.Record, error) {
	if args.Limit <= 0 {
		return nil, ipcerr.BadRequest("limit must be positive")
	}
	return s.Log.Recent(args.Limit), nil
}

type OpsCancelArgs struct {
	OpID string `json:"opId"`
}

// Cancel is not an error when the op already finished or is not cancellable.
func (s *OpsService) Cancel(args OpsCancelArgs) error {
	if args.OpID == "" {
		return ipcerr.BadRequest("opId is required")
	}
	s.Log.Cancel(args.OpID)
	return nil
}
