package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

type TabsService struct {
	Deps appcore.Deps
}

type TabsListArgs struct {
	WindowKey string `json:"windowKey"`
}

// List returns args.WindowKey's own tab set (P8 F6/C4 — tabs are per-window, not app-wide).
func (s *TabsService) List(args TabsListArgs) ([]model.TabRecord, error) {
	return appstorage.ListWindowTabs(s.Deps.Repos.Windows, s.Deps.Repos.Tabs, args.WindowKey)
}

type TabsSaveArgs struct {
	WindowKey string            `json:"windowKey"`
	Tabs      []model.TabRecord `json:"tabs"`
}

func (s *TabsService) Save(args TabsSaveArgs) error {
	return appstorage.SaveWindowTabs(s.Deps.Repos.Windows, s.Deps.Repos.Tabs, args.WindowKey, args.Tabs)
}
