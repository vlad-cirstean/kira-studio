package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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
	// G31 round-2 functional-correctness review, finding #8: EnsureAutoFetch's only other caller
	// is Conn.Open (gitsession's own off→on path) — a repository already open when the user turns
	// fetch.autoInterval back on from 0 had no way to ever restart auto-fetch without a fresh
	// repo.open, since pauseAutoFetch (armed the moment the interval reads 0) leaves nothing
	// scheduled to notice a later settings change on its own. This is the actual write path for
	// that setting (git.path's own sibling in the same instance-wide GitPatch); repoSettings.set
	// is a different, per-repo settings surface that never carries it.
	if args.Patch.Git != nil && args.Patch.Git.FetchAutoIntervalMinutes != nil && s.Deps.GitRegistry != nil {
		s.Deps.GitRegistry.ReconcileAutoFetch()
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)
	return merged, nil
}
