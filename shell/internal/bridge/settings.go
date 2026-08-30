package bridge

import (
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

type SettingsService struct {
	Deps appcore.Deps
}

func (s *SettingsService) GetAll() (model.Settings, error) {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		return model.Settings{}, ipcerr.Internal(err.Error())
	}
	return settings, nil
}

type SettingsSetArgs struct {
	Patch model.SettingsPatch `json:"patch"`
}

// Set ports src/main/ipc/settings.ts verbatim: merge, conditionally re-push the engine's cache
// budget when cache.l2BudgetMb was in the patch, then broadcast the merged settings
// unconditionally — the broadcast closes the gap settings.ts:15-18 names (a settings change made
// through any path other than the renderer's own patchSettings() wrapper would otherwise never
// reach the renderer's local settingsState).
func (s *SettingsService) Set(args SettingsSetArgs) (model.Settings, error) {
	merged, err := s.Deps.Repos.Settings.Set(args.Patch)
	if err != nil {
		return model.Settings{}, ipcerr.Internal(err.Error())
	}
	if args.Patch.Cache != nil && args.Patch.Cache.L2BudgetMb != nil {
		s.Deps.Router.PushCacheConfig(merged)
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)
	return merged, nil
}
