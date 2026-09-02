package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// SchemaService is the DDL half of P18 (v1.1)'s language service — Get/Set for the
// `connection_ddl` document, modelled method-for-method on FiltersService.
type SchemaService struct {
	Deps appcore.Deps
}

type SchemaGetArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *SchemaService) Get(args SchemaGetArgs) (model.ConnectionDDL, error) {
	if args.ConnectionID == "" {
		return model.ConnectionDDL{}, ipcerr.BadRequest("connectionId is required")
	}
	ddl, err := s.Deps.Repos.Schema.Get(args.ConnectionID)
	if err != nil {
		return model.ConnectionDDL{}, ipcerr.Internal(err.Error())
	}
	return ddl, nil
}

type SchemaSetArgs struct {
	ConnectionID string `json:"connectionId"`
	DDL          string `json:"ddl"`
}

// Set persists the DDL text and broadcasts unconditionally — mirroring LayoutService.Set/
// SettingsService.Set (D4): a console open in another window must pick up the edit without a
// relaunch.
func (s *SchemaService) Set(args SchemaSetArgs) (model.ConnectionDDL, error) {
	if args.ConnectionID == "" {
		return model.ConnectionDDL{}, ipcerr.BadRequest("connectionId is required")
	}
	ddl, err := s.Deps.Repos.Schema.Set(args.ConnectionID, args.DDL)
	if err != nil {
		return model.ConnectionDDL{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSchemaChanged, ddl)
	return ddl, nil
}
