package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// GrpcHistoryService is ResponseHistoryService's own gRPC sibling (P11 D11) — same shape, same
// "no op-log row, a single indexed local read or single-row write" reasoning. Recording itself is
// not here at all — it is bridge/grpc.go's own recordGrpcHistory call inside Call's RunOp closure.
type GrpcHistoryService struct{ Deps appcore.Deps }

type GrpcHistoryScopeArgs struct {
	ItemID string `json:"itemId"`
	TabID  string `json:"tabId"`
}

// List returns newest-first, at most 20 entries by construction (Record's own per-scope trim).
func (s *GrpcHistoryService) List(args GrpcHistoryScopeArgs) ([]model.GrpcCallHistoryEntry, error) {
	entries, err := s.Deps.Repos.GrpcHistory.List(scopeKey(args.ItemID, args.TabID))
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return entries, nil
}

type GrpcHistoryIDArgs struct {
	ID string `json:"id"`
}

func (s *GrpcHistoryService) Get(args GrpcHistoryIDArgs) (model.GrpcCallSnapshot, error) {
	if args.ID == "" {
		return model.GrpcCallSnapshot{}, ipcerr.BadRequest("id is required")
	}
	snap, err := s.Deps.Repos.GrpcHistory.Get(args.ID)
	if err != nil {
		return model.GrpcCallSnapshot{}, ipcerr.Internal(err.Error())
	}
	return snap, nil
}

func (s *GrpcHistoryService) Delete(args GrpcHistoryIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.GrpcHistory.Delete(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

func (s *GrpcHistoryService) Clear(args GrpcHistoryScopeArgs) error {
	if err := s.Deps.Repos.GrpcHistory.Clear(scopeKey(args.ItemID, args.TabID)); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

type GrpcHistoryAdoptArgs struct {
	TabID  string `json:"tabId"`
	ItemID string `json:"itemId"`
}

type GrpcHistoryAdoptResult struct {
	Adopted int `json:"adopted"`
}

// Adopt mirrors ResponseHistoryService's own D14: a scratch tab's entries move onto a newly-saved
// request's id.
func (s *GrpcHistoryService) Adopt(args GrpcHistoryAdoptArgs) (GrpcHistoryAdoptResult, error) {
	if args.TabID == "" || args.ItemID == "" {
		return GrpcHistoryAdoptResult{}, ipcerr.BadRequest("tabId and itemId are required")
	}
	n, err := s.Deps.Repos.GrpcHistory.Adopt(args.TabID, args.ItemID)
	if err != nil {
		return GrpcHistoryAdoptResult{}, ipcerr.Internal(err.Error())
	}
	return GrpcHistoryAdoptResult{Adopted: n}, nil
}
