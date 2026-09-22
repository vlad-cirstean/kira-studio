package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// LayoutService is Kira Studio's own LayoutService (internal/bridge/layout.go), unchanged shape —
// only model.Layout itself is trimmed (storage/model/layout.go).
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

// Set merges and persists the patch, then broadcasts the merged layout unconditionally — panel
// layout is app-wide by design, so every window must agree.
func (s *LayoutService) Set(args LayoutSetArgs) (model.Layout, error) {
	merged, err := s.Deps.Repos.Layout.Set(args.Patch)
	if err != nil {
		return model.Layout{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelLayoutChanged, merged)
	return merged, nil
}
