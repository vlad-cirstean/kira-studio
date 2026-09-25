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

// MaskRulesChangedEvent is ChannelMaskRulesChanged's own payload — schemaChanged's per-connection
// shape: every window's own `['maskRules', connectionId]` query cache entry (state/maskRules.ts's
// applyRemote) is written straight from this, no refetch. KeyRegenerated is set only by
// RegenerateKey below — the one case a receiving window must also drop its own cached correlation
// key (state/maskRules.ts's correlationKeys), matching what regenerateMaskKey already does for the
// window that triggered it.
type MaskRulesChangedEvent struct {
	ConnectionID   string           `json:"connectionId"`
	Rules          []model.MaskRule `json:"rules"`
	KeyRegenerated bool             `json:"keyRegenerated"`
}

// broadcastRules re-lists connectionID's own rules and emits them — called after every mutation
// below, so a caller never reads a snapshot older than what it just wrote. Mirrors
// CustomScriptsService's own broadcastList (bridge/customscripts.go), scoped to one connection
// since mask rules are per-connection state, not a flat app-wide list.
func (s *MaskRulesService) broadcastRules(connectionID string, keyRegenerated bool) {
	rows, err := s.Deps.MaskRules.List(connectionID)
	if err != nil {
		return
	}
	s.Deps.Events.Emit(ChannelMaskRulesChanged, MaskRulesChangedEvent{
		ConnectionID:   connectionID,
		Rules:          rows,
		KeyRegenerated: keyRegenerated,
	})
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
	s.broadcastRules(args.ConnectionID, false)
	return rec, nil
}

type MaskRulesRemoveArgs struct {
	ID string `json:"id"`
}

func (s *MaskRulesService) Remove(args MaskRulesRemoveArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	// Removed by id alone — the connection it belonged to has to be resolved before the row is gone,
	// so broadcastRules below still knows which connection's cache to refresh. (nil, nil) when the
	// id is already gone (maskrules.Service.Remove's own idempotent-remove semantics): nothing to
	// broadcast then, since nothing actually changed.
	existing, err := s.Deps.Repos.MaskRules.Get(args.ID)
	if err != nil {
		return ipcerr.InternalErr(err)
	}
	if err := s.Deps.MaskRules.Remove(args.ID); err != nil {
		return ipcerr.BadRequest(err.Error())
	}
	if existing != nil {
		s.broadcastRules(existing.ConnectionID, false)
	}
	return nil
}

type MaskRulesRegenerateKeyArgs struct {
	ConnectionID string `json:"connectionId"`
}

func (s *MaskRulesService) RegenerateKey(args MaskRulesRegenerateKeyArgs) error {
	if args.ConnectionID == "" {
		return ipcerr.BadRequest("connectionId is required")
	}
	if err := s.Deps.MaskRules.RegenerateKey(args.ConnectionID); err != nil {
		return err
	}
	s.broadcastRules(args.ConnectionID, true)
	return nil
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
