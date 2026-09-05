package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// VariablesService is P5 D19 — the CollectionsService/QueriesService shape (a typed-struct
// wrapper per method, with an explicit guard and an ipcerr translation). Every plain CRUD method
// wraps Deps.Repos.Variables directly, exactly as CollectionsService wraps Deps.Repos.Collections
// (P4 D11) — no service layer buys anything for a straight repo call. Reveal/RevealHistory are the
// two exceptions: they need the Authorizer gate, so they go through Deps.ApiVars instead (D8).
type VariablesService struct{ Deps appcore.Deps }

// ---- environments (D3) ----

func (s *VariablesService) ListEnvironments() ([]model.Environment, error) {
	envs, err := s.Deps.Repos.Variables.ListEnvironments()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return envs, nil
}

type VariablesCreateEnvironmentArgs struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *VariablesService) CreateEnvironment(args VariablesCreateEnvironmentArgs) (model.Environment, error) {
	if args.Name == "" {
		return model.Environment{}, ipcerr.BadRequest("name is required")
	}
	env, err := s.Deps.Repos.Variables.CreateEnvironment(args.Name, args.Description)
	if err != nil {
		return model.Environment{}, ipcerr.Internal(err.Error())
	}
	return env, nil
}

// VariablesUpdateEnvironmentArgs replaces VariablesRenameEnvironmentArgs (P17 D14): renaming and
// describing an environment are one row update — one IPC call for one blur is worse than one.
type VariablesUpdateEnvironmentArgs struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *VariablesService) UpdateEnvironment(args VariablesUpdateEnvironmentArgs) error {
	if args.ID == "" || args.Name == "" {
		return ipcerr.BadRequest("id and name are required")
	}
	if err := s.Deps.Repos.Variables.UpdateEnvironment(args.ID, args.Name, args.Description); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

type VariablesEnvironmentIDArgs struct {
	ID string `json:"id"`
}

func (s *VariablesService) DeleteEnvironment(args VariablesEnvironmentIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.Variables.DeleteEnvironment(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// DuplicateEnvironment is P17 D17/item 4 — see repos/variables.go's own DuplicateEnvironment.
func (s *VariablesService) DuplicateEnvironment(args VariablesEnvironmentIDArgs) (model.Environment, error) {
	if args.ID == "" {
		return model.Environment{}, ipcerr.BadRequest("id is required")
	}
	env, err := s.Deps.Repos.Variables.DuplicateEnvironment(args.ID)
	if err != nil {
		return model.Environment{}, ipcerr.Internal(err.Error())
	}
	return env, nil
}

// SetActiveEnvironment's id may be "" — D3: that selects "No environment", the first half of the
// repo's own transaction alone.
func (s *VariablesService) SetActiveEnvironment(args VariablesEnvironmentIDArgs) error {
	if err := s.Deps.Repos.Variables.SetActiveEnvironment(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

type VariablesReorderEnvironmentsArgs struct {
	IDs []string `json:"ids"`
}

func (s *VariablesService) ReorderEnvironments(args VariablesReorderEnvironmentsArgs) error {
	if err := s.Deps.Repos.Variables.ReorderEnvironments(args.IDs); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// ---- variables (D4/D5/D12) ----

// VariablesScopeArgs names one scope's owner — 'collection' or 'environment' plus that table's own
// id — the same two-table discriminator CollectionsTargetArgs already uses for collections/items.
type VariablesScopeArgs struct {
	Scope   model.VariableScope `json:"scope"`
	OwnerID string              `json:"ownerId"`
}

func validScope(scope model.VariableScope) error {
	if scope != model.VariableScopeCollection && scope != model.VariableScopeEnvironment {
		return ipcerr.BadRequest("scope must be 'collection' or 'environment'")
	}
	return nil
}

func (s *VariablesService) List(args VariablesScopeArgs) ([]model.Variable, error) {
	if err := validScope(args.Scope); err != nil {
		return nil, err
	}
	if args.OwnerID == "" {
		return nil, ipcerr.BadRequest("ownerId is required")
	}
	list, err := s.Deps.Repos.Variables.List(args.Scope, args.OwnerID)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

// VariablesUpsertArgs's ID is "" for a create (D19). Value is always the plaintext — the one
// direction D5 never restricts: the user just typed it into a revealed, editable field.
type VariablesUpsertArgs struct {
	Scope       model.VariableScope `json:"scope"`
	OwnerID     string              `json:"ownerId"`
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Value       string              `json:"value"`
	IsSecret    bool                `json:"isSecret"`
	Description string              `json:"description"`
}

func (s *VariablesService) Upsert(args VariablesUpsertArgs) (model.Variable, error) {
	if err := validScope(args.Scope); err != nil {
		return model.Variable{}, err
	}
	if args.Name == "" {
		return model.Variable{}, ipcerr.BadRequest("name is required")
	}
	v, err := s.Deps.Repos.Variables.Upsert(args.Scope, args.OwnerID, args.ID, args.Name, args.Value, args.IsSecret, args.Description)
	if err != nil {
		return model.Variable{}, ipcerr.Internal(err.Error())
	}
	return v, nil
}

type VariablesIDArgs struct {
	ID string `json:"id"`
}

func (s *VariablesService) Delete(args VariablesIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.Variables.Delete(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

type VariablesReorderArgs struct {
	Scope   model.VariableScope `json:"scope"`
	OwnerID string              `json:"ownerId"`
	IDs     []string            `json:"ids"`
}

func (s *VariablesService) Reorder(args VariablesReorderArgs) error {
	if err := validScope(args.Scope); err != nil {
		return err
	}
	if err := s.Deps.Repos.Variables.Reorder(args.Scope, args.OwnerID, args.IDs); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// VariablesApplyBulkArgs is P17 D21-D23/item 5: one scope's whole variable set, replaced by a
// parsed `.env` entry list in one transaction (VariablesRepo.ApplyBulk).
type VariablesApplyBulkArgs struct {
	Scope   model.VariableScope       `json:"scope"`
	OwnerID string                    `json:"ownerId"`
	Entries []model.VariableBulkEntry `json:"entries"`
}

func (s *VariablesService) ApplyBulk(args VariablesApplyBulkArgs) (model.VariableBulkResult, error) {
	if err := validScope(args.Scope); err != nil {
		return model.VariableBulkResult{}, err
	}
	if args.OwnerID == "" {
		return model.VariableBulkResult{}, ipcerr.BadRequest("ownerId is required")
	}
	result, err := s.Deps.Repos.Variables.ApplyBulk(args.Scope, args.OwnerID, args.Entries)
	if err != nil {
		return model.VariableBulkResult{}, ipcerr.Internal(err.Error())
	}
	return result, nil
}

// ---- history (D13) ----

type VariablesHistoryArgs struct {
	VariableID string `json:"variableId"`
}

func (s *VariablesService) History(args VariablesHistoryArgs) ([]model.VariableHistoryEntry, error) {
	if args.VariableID == "" {
		return nil, ipcerr.BadRequest("variableId is required")
	}
	list, err := s.Deps.Repos.Variables.History(args.VariableID)
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return list, nil
}

// ---- the gated reveal (D8/D9) ----

type VariablesRevealArgs struct {
	VariableID string `json:"variableId"`
	// Confirmed is honoured only when the backend has itself determined OS authentication is
	// unavailable (mirrors bridge.ConnectionsRevealArgs.Confirmed exactly — P14 D6).
	Confirmed bool `json:"confirmed"`
}

// Reveal never errors (P25 D9) — see apivars.Service.Reveal's own comment.
func (s *VariablesService) Reveal(args VariablesRevealArgs) apivars.RevealResult {
	if args.VariableID == "" {
		msg := "variableId is required"
		return apivars.RevealResult{Outcome: apivars.OutcomeError, Error: &msg}
	}
	return s.Deps.ApiVars.Reveal(args.VariableID, args.Confirmed)
}

type VariablesRevealHistoryArgs struct {
	HistoryID string `json:"historyId"`
	Confirmed bool   `json:"confirmed"`
}

func (s *VariablesService) RevealHistory(args VariablesRevealHistoryArgs) apivars.RevealResult {
	if args.HistoryID == "" {
		msg := "historyId is required"
		return apivars.RevealResult{Outcome: apivars.OutcomeError, Error: &msg}
	}
	return s.Deps.ApiVars.RevealHistory(args.HistoryID, args.Confirmed)
}
