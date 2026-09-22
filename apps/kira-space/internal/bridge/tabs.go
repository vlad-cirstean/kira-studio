package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// TabsService is Kira Studio's own TabsService (internal/bridge/tabs.go), unchanged shape.
type TabsService struct {
	Deps appcore.Deps
}

type TabsListArgs struct {
	WindowKey string `json:"windowKey"`
}

func (s *TabsService) List(args TabsListArgs) ([]model.TabRecord, error) {
	if err := s.checkWindow(args.WindowKey); err != nil {
		return nil, err
	}
	tabs, err := s.Deps.Repos.Tabs.List(args.WindowKey)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return tabs, nil
}

type TabsSaveArgs struct {
	WindowKey string            `json:"windowKey"`
	Tabs      []model.TabRecord `json:"tabs"`
}

func (s *TabsService) Save(args TabsSaveArgs) error {
	if err := s.checkWindow(args.WindowKey); err != nil {
		return err
	}
	if err := s.Deps.Repos.Tabs.Save(args.WindowKey, args.Tabs); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// checkWindow rejects a windowKey that names no `windows` row with a real E_BAD_REQUEST, rather
// than letting it surface as TabsRepo.Save's raw FOREIGN KEY constraint failure.
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
