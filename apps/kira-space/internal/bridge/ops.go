package bridge

import (
	"context"

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
		return nil, ipcerr.Contract("limit must be positive")
	}
	return s.Log.Recent(args.Limit), nil
}

type OpsCancelArgs struct {
	OpID string `json:"opId"`
}

// Cancel is not an error when the op already finished or is not cancellable.
func (s *OpsService) Cancel(args OpsCancelArgs) error {
	if args.OpID == "" {
		return ipcerr.Required("opId")
	}
	s.Log.Cancel(args.OpID)
	return nil
}

// filesCtx stamps spawns started by a Files-module call.
func filesCtx(ctx context.Context) context.Context {
	return oplog.WithOrigin(ctx, oplog.Origin{Module: oplog.ModuleFiles, Trigger: oplog.TriggerUser, Label: "Kira Space files"})
}

// adeUserCtx stamps spawns started by an ADE call from the UI (or a phone going through AdeTaskService).
func adeUserCtx(ctx context.Context) context.Context {
	return oplog.WithOrigin(ctx, oplog.Origin{Module: oplog.ModuleADE, Trigger: oplog.TriggerUser, Label: "Kira Space ade board"})
}
