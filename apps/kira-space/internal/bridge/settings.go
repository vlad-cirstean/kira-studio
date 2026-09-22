package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/logging"
)

// SettingsService is Kira Studio's own SettingsService (internal/bridge/settings.go), trimmed:
// this app has no adapterhost.Router to push a cache budget through, so the
// `args.Patch.Cache != nil` branch there has no equivalent here (this app's model.Settings never
// grew a Cache leaf).
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

// Set merges the patch, applies advanced.gitLogLevel immediately (Kira Studio's own P72 §9.2
// mechanism), then broadcasts the merged settings unconditionally.
func (s *SettingsService) Set(args SettingsSetArgs) (model.Settings, error) {
	merged, err := s.Deps.Repos.Settings.Set(args.Patch)
	if err != nil {
		return model.Settings{}, ipcerr.Internal(err.Error())
	}
	if args.Patch.Advanced != nil && args.Patch.Advanced.GitLogLevel != nil {
		logging.SetLevel(*args.Patch.Advanced.GitLogLevel)
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)
	return merged, nil
}
