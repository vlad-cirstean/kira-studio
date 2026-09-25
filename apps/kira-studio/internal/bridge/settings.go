package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/logging"
)

type SettingsService struct {
	Deps appcore.Deps
}

func (s *SettingsService) GetAll() (model.Settings, error) {
	return ipcerr.InternalResult(s.Deps.Repos.Settings.GetAll())
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
	// P100 Part 1: the git.fetchAutoIntervalMinutes -> GitRegistry.ReconcileAutoFetch side effect
	// that used to live here moved with the git module to apps/kira-space (its own bridge/
	// settings.go has no equivalent yet — Kira Space has no SettingsService of its own in Part 1).
	// The git.* leaves themselves (GitSettings: ProtectedBranches/FetchAutoIntervalMinutes/
	// GitPath/GraphFontSize) stay on model.Settings unchanged: removing them cleanly needs a
	// matching frontend/packages/shared schema change, out of this phase's Go-only scope — see
	// this phase's own result section.
	// P72 §9.2: advanced.gitLogLevel's own actual mechanism — apply the new verbosity immediately
	// rather than only on next launch.
	if args.Patch.Advanced != nil && args.Patch.Advanced.GitLogLevel != nil {
		logging.SetLevel(*args.Patch.Advanced.GitLogLevel)
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)
	return merged, nil
}
