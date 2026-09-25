package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appstorage"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

type TabsService struct {
	Deps appcore.Deps
}

type TabsListArgs struct {
	WindowKey string `json:"windowKey"`
}

// List returns args.WindowKey's own tab set (P8 F6/C4 — tabs are per-window, not app-wide).
func (s *TabsService) List(args TabsListArgs) ([]model.TabRecord, error) {
	if err := s.checkWindow(args.WindowKey); err != nil {
		return nil, err
	}
	return ipcerr.InternalResult(s.Deps.Repos.Tabs.List(args.WindowKey))
}

type TabsSaveArgs struct {
	WindowKey string            `json:"windowKey"`
	Tabs      []model.TabRecord `json:"tabs"`
}

func (s *TabsService) Save(args TabsSaveArgs) error {
	return appstorage.SaveWindowTabs(s.Deps.Repos.Windows, s.Deps.Repos.Tabs, args.WindowKey, args.Tabs)
}

// checkWindow rejects a windowKey that names no `windows` row with a real E_BAD_REQUEST, rather
// than letting it surface as TabsRepo.Save's raw FOREIGN KEY constraint failure (C4).
func (s *TabsService) checkWindow(windowKey string) error {
	ok, err := s.Deps.Repos.Windows.Exists(windowKey)
	if err != nil {
		return ipcerr.Internal(err.Error())
	}
	if !ok {
		return ipcerr.BadRequest("unknown window: " + windowKey)
	}
	return nil
}
