package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

type LayoutService struct {
	Deps appcore.Deps
}

func (s *LayoutService) GetAll() (model.Layout, error) {
	layout, err := s.Deps.Repos.Layout.GetAll()
	if err != nil {
		return model.Layout{}, ipcerr.Internal(err.Error())
	}
	return layout, nil
}

type LayoutSetArgs struct {
	Patch model.LayoutPatch `json:"patch"`
}

// Set merges and persists the patch, then broadcasts the merged layout unconditionally —
// mirroring SettingsService.Set (settings.go, events.go's ChannelSettingsChanged). Panel layout
// is app-wide by design (P8 D3: a preference like font size, not a per-window fact), and
// "app-wide" is only true if every window actually agrees — before this, window A resizing the
// project panel left window B showing the old width until relaunch (F7's second half).
func (s *LayoutService) Set(args LayoutSetArgs) (model.Layout, error) {
	merged, err := s.Deps.Repos.Layout.Set(args.Patch)
	if err != nil {
		return model.Layout{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelLayoutChanged, merged)
	return merged, nil
}
