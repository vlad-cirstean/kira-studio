package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// TabsService is Kira Studio's own TabsService (internal/bridge/tabs.go), unchanged shape.
type TabsService struct {
	Deps appcore.Deps
}

type TabsListArgs struct {
	WindowKey string `json:"windowKey"`
}

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
