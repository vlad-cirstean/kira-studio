package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

type TabsService struct {
	Deps appcore.Deps
}

func (s *TabsService) List() ([]model.TabRecord, error) {
	tabs, err := s.Deps.Repos.Tabs.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return tabs, nil
}

type TabsSaveArgs struct {
	Tabs []model.TabRecord `json:"tabs"`
}

func (s *TabsService) Save(args TabsSaveArgs) error {
	if err := s.Deps.Repos.Tabs.Save(args.Tabs); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
