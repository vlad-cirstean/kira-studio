package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// MaskRulesService is M5's Privacy-tab/header-menu surface (docs/v1.7/plans/
// M5-anonymization-masking.md §4.6) — connections.go's own per-method-args-struct shape (:22-31),
// each argument validated with ipcerr.BadRequest here; the actual domain validation (a valid kind,
// a non-empty column name, forcing correlate=false for `number`) lives in maskrules.Service.Upsert.
type MaskRulesService struct {
	Deps appcore.Deps
}

// MaskRulesListArgs is shared by every method below that needs nothing but a connection id.
type MaskRulesListArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *MaskRulesService) List(args MaskRulesListArgs) ([]model.MaskRule, error) {
	if args.ConnectionID == "" {
		return nil, ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.MaskRules.List(args.ConnectionID)
}

type MaskRulesUpsertArgs struct {
	ConnectionID string               `json:"connectionId"`
	Fields       model.MaskRuleFields `json:"fields"`
}

func (s *MaskRulesService) Upsert(args MaskRulesUpsertArgs) (model.MaskRule, error) {
	if args.ConnectionID == "" {
		return model.MaskRule{}, ipcerr.BadRequest("connectionId is required")
	}
	rec, err := s.Deps.MaskRules.Upsert(args.ConnectionID, args.Fields)
	if err != nil {
		return model.MaskRule{}, ipcerr.BadRequest(err.Error())
	}
	return rec, nil
}

type MaskRulesRemoveArgs struct {
	ID string `json:"id"`
}

func (s *MaskRulesService) Remove(args MaskRulesRemoveArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	return s.Deps.MaskRules.Remove(args.ID)
}

type MaskRulesRegenerateKeyArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *MaskRulesService) RegenerateKey(args MaskRulesRegenerateKeyArgs) error {
	if args.ConnectionID == "" {
		return ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.MaskRules.RegenerateKey(args.ConnectionID)
}

// Counts is the Settings glance's own backend (§7.5) — every connection id with at least one rule,
// mapped to its rule count.
func (s *MaskRulesService) Counts() (map[string]int, error) {
	return s.Deps.MaskRules.Counts()
}

// CorrelationKey returns connectionID's own correlation key, hex-encoded ("" when none is needed)
// — the one seam that sends the raw key to the renderer, for the grid preview's own local tag
// computation (§6.3). Not part of the plan's originally named bridge methods; see
// maskrules.Service.CorrelationKeyHex's own comment for why it exists and why it is scoped this
// narrowly.
func (s *MaskRulesService) CorrelationKey(args MaskRulesListArgs) (string, error) {
	if args.ConnectionID == "" {
		return "", ipcerr.BadRequest("connectionId is required")
	}
	return s.Deps.MaskRules.CorrelationKeyHex(args.ConnectionID)
}
