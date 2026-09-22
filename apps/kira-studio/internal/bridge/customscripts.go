package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// CustomScriptsService is P85 §9.1's own bound surface over the `custom_scripts` table —
// MaskRulesService's own per-method-args-struct shape, reaching s.Deps.Repos.CustomScripts
// directly rather than through a dedicated Deps field: CollectionsService already establishes
// that a service wrapping one repo needs none. Every mutation broadcasts the full list on
// ChannelCustomScriptsChanged (Emit, not EmitTo) so a second window's dropdown stays live
// (state/customScripts.ts's own onCustomScriptsChanged subscription).
type CustomScriptsService struct {
	Deps appcore.Deps
}

func (s *CustomScriptsService) List() ([]model.CustomScript, error) {
	rows, err := s.Deps.Repos.CustomScripts.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return rows, nil
}

// broadcastList re-lists and emits — called after every mutation below, so a caller never reads a
// snapshot older than what it just wrote.
func (s *CustomScriptsService) broadcastList() {
	rows, err := s.Deps.Repos.CustomScripts.List()
	if err != nil {
		return
	}
	s.Deps.Events.Emit(ChannelCustomScriptsChanged, rows)
}

type CustomScriptsCreateArgs struct {
	Fields model.CustomScriptFields `json:"fields"`
}

func (s *CustomScriptsService) Create(args CustomScriptsCreateArgs) (model.CustomScript, error) {
	rec, err := s.Deps.Repos.CustomScripts.Create(args.Fields)
	if err != nil {
		return model.CustomScript{}, ipcerr.BadRequest(err.Error())
	}
	s.broadcastList()
	return rec, nil
}

type CustomScriptsUpdateArgs struct {
	ID     string                   `json:"id"`
	Fields model.CustomScriptFields `json:"fields"`
}

func (s *CustomScriptsService) Update(args CustomScriptsUpdateArgs) (model.CustomScript, error) {
	if args.ID == "" {
		return model.CustomScript{}, ipcerr.BadRequest("id is required")
	}
	rec, err := s.Deps.Repos.CustomScripts.Update(args.ID, args.Fields)
	if err != nil {
		return model.CustomScript{}, ipcerr.BadRequest(err.Error())
	}
	s.broadcastList()
	return rec, nil
}

type CustomScriptsRemoveArgs struct {
	ID string `json:"id"`
}

func (s *CustomScriptsService) Remove(args CustomScriptsRemoveArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	// The only failure mode reaching this layer is an unknown id (sql.ErrNoRows, wrapped) —
	// idempotent-remove semantics are Settings' own confirm-first UI, not this layer's job.
	if err := s.Deps.Repos.CustomScripts.Remove(args.ID); err != nil {
		return ipcerr.BadRequest(err.Error())
	}
	s.broadcastList()
	return nil
}
