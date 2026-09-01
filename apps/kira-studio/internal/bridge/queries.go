package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// QueriesService is 1:1 with src/main/ipc/queries.ts's nine methods, each a typed-struct wrapper
// over Deps.Repos.SavedQueries / Deps.Repos.FilterHistory with an explicit guard and an ipcerr
// translation. Name-length validation is not repeated here — it already lives in
// SavedQueriesRepo.insert/Update via model.ValidSavedQueryName.
type QueriesService struct{ Deps appcore.Deps }

type QueriesListArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
}

func (s *QueriesService) List(args QueriesListArgs) ([]model.SavedQuery, error) {
	if args.ConnectionID == "" {
		return nil, ipcerr.BadRequest("connectionId is required")
	}
	list, err := s.Deps.Repos.SavedQueries.ListFilters(args.ConnectionID, args.Path)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

func (s *QueriesService) ListConsole(args QueriesListArgs) ([]model.SavedQuery, error) {
	if args.ConnectionID == "" {
		return nil, ipcerr.BadRequest("connectionId is required")
	}
	list, err := s.Deps.Repos.SavedQueries.ListConsole(args.ConnectionID, args.Path)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

type QueriesSaveArgs struct {
	ConnectionID string           `json:"connectionId"`
	Path         string           `json:"path"`
	Name         string           `json:"name"`
	Body         model.FilterBody `json:"body"`
	Pinned       bool             `json:"pinned"`
}

func (s *QueriesService) Save(args QueriesSaveArgs) (model.SavedQuery, error) {
	if args.ConnectionID == "" {
		return model.SavedQuery{}, ipcerr.BadRequest("connectionId is required")
	}
	q, err := s.Deps.Repos.SavedQueries.SaveFilter(args.ConnectionID, args.Path, args.Name, args.Body, args.Pinned)
	if err != nil {
		return model.SavedQuery{}, ipcerr.Internal(err.Error())
	}
	return q, nil
}

type QueriesSaveConsoleArgs struct {
	ConnectionID string            `json:"connectionId"`
	Path         string            `json:"path"`
	Name         string            `json:"name"`
	Body         model.ConsoleBody `json:"body"`
	Pinned       bool              `json:"pinned"`
}

func (s *QueriesService) SaveConsole(args QueriesSaveConsoleArgs) (model.SavedQuery, error) {
	if args.ConnectionID == "" {
		return model.SavedQuery{}, ipcerr.BadRequest("connectionId is required")
	}
	q, err := s.Deps.Repos.SavedQueries.SaveConsole(args.ConnectionID, args.Path, args.Name, args.Body, args.Pinned)
	if err != nil {
		return model.SavedQuery{}, ipcerr.Internal(err.Error())
	}
	return q, nil
}

type QueriesUpdateArgs struct {
	ID     string  `json:"id"`
	Name   *string `json:"name,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}

func (s *QueriesService) Update(args QueriesUpdateArgs) (model.SavedQuery, error) {
	if args.ID == "" {
		return model.SavedQuery{}, ipcerr.BadRequest("id is required")
	}
	q, err := s.Deps.Repos.SavedQueries.Update(args.ID, model.SavedQueryPatch{Name: args.Name, Pinned: args.Pinned})
	if err != nil {
		return model.SavedQuery{}, ipcerr.Internal(err.Error())
	}
	return q, nil
}

type QueriesIDArgs struct {
	ID string `json:"id"`
}

func (s *QueriesService) Delete(args QueriesIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.SavedQueries.Delete(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

func (s *QueriesService) Touch(args QueriesIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.SavedQueries.Touch(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

type QueriesHistoryListArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
	Limit        int    `json:"limit"`
}

func (s *QueriesService) HistoryList(args QueriesHistoryListArgs) ([]model.FilterHistoryEntry, error) {
	if args.ConnectionID == "" {
		return nil, ipcerr.BadRequest("connectionId is required")
	}
	if args.Limit < 1 || args.Limit > 100 {
		return nil, ipcerr.BadRequest("limit must be between 1 and 100")
	}
	list, err := s.Deps.Repos.FilterHistory.List(args.ConnectionID, args.Path, args.Limit)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

type QueriesHistoryRecordArgs struct {
	ConnectionID string          `json:"connectionId"`
	Path         string          `json:"path"`
	Where        *string         `json:"where"`
	OrderBy      *model.SortSpec `json:"orderBy"`
}

func (s *QueriesService) HistoryRecord(args QueriesHistoryRecordArgs) error {
	if args.ConnectionID == "" {
		return ipcerr.BadRequest("connectionId is required")
	}
	if err := s.Deps.Repos.FilterHistory.Record(args.ConnectionID, args.Path, args.Where, args.OrderBy); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
