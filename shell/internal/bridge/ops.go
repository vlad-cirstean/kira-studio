package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
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

type OpsCancelArgs struct {
	OpID string `json:"opId"`
}

// Cancel is a bare passthrough to the engine (src/main/ipc/ops.ts:16-19) — there is nothing in
// internal/oplog to build on, which is why P55 §7 left it here.
func (s *OpsService) Cancel(args OpsCancelArgs) error {
	if args.OpID == "" {
		return ipcerr.BadRequest("opId is required")
	}
	_, err := s.Deps.EngineHost.Call(enginehost.OpCancel, map[string]any{"opId": args.OpID})
	return err
}
