package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

type TabsService struct {
	Deps appcore.Deps
}

func (s *TabsService) List() ([]repos.TabRecord, error) {
	tabs, err := s.Deps.Tabs.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return tabs, nil
}

type TabsSaveArgs struct {
	Tabs []repos.TabRecord `json:"tabs"`
}

func (s *TabsService) Save(args TabsSaveArgs) error {
	if err := s.Deps.Tabs.Save(args.Tabs); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}
