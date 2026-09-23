package model

import (
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// TabRecord's `State` stays raw JSON here — Kira Studio's own model.TabRecord (storage/model/
// tabs.go) does the same, for the same reason (D3): packages/shared/domain/tabs.ts's per-kind
// discriminated union is renderer-side validation logic, not storage shape. Go validates only the
// envelope it owns: kind is in RenderableTabKinds and State parses as a JSON object.
//
// Kira Studio's own TabRecord also carries ConnectionID (a DB-connection scope) — Kira Space has
// no connections concept, so this copy drops that field entirely (P100 Part 2, plan §5.4).
// WorkspaceID is required here for every kind, unlike Kira Studio's own optional field: every tab
// kind this app has is scoped to a repository, so there is no "app-wide" tab to fall back to.
type TabRecord struct {
	ID          string          `json:"id"`
	Path        string          `json:"path"`
	Kind        string          `json:"kind"`
	State       json.RawMessage `json:"state"`
	Order       int             `json:"order"`
	Active      bool            `json:"active"`
	WorkspaceID *string         `json:"workspaceId"`
}

// RenderableTabKinds is Kira Studio's own RenderableTabKinds, trimmed to the five kinds P100 Part
// 2 actually moved (the studio/api/http vocabulary stays behind in Kira Studio) — the five kinds
// C5/C6/P83/P92 gave the repo workspace on Kira Studio, before this phase relocated them here.
var RenderableTabKinds = map[string]bool{
	"repo-graph":      true,
	"repo-file":       true,
	"repo-diff":       true,
	"repo-multi-diff": true,
	"terminal":        true,
}

// IsRenderableTabKind reports whether kind is one of the renderable tab kinds.
func IsRenderableTabKind(kind string) bool {
	return RenderableTabKinds[kind]
}

// IsJSONObject reports whether raw is valid JSON whose top-level value is an object — Kira
// Studio's own IsJSONObject, unchanged.
func IsJSONObject(raw []byte) bool {
	return appstorage.IsJSONObject(raw)
}

// Validate asserts the same envelope repos.TabsRepo.List already enforces on read, plus the
// non-empty identity fields no SQL constraint covers — Kira Studio's own TabRecord.Validate,
// minus the ConnectionID it never had here, and with WorkspaceID required unconditionally rather
// than only for a `repoTabKinds` subset (every kind here is a repo kind).
func (t TabRecord) Validate() error {
	if t.ID == "" {
		return fmt.Errorf("model: tab: id is required")
	}
	if t.Path == "" {
		return fmt.Errorf("model: tab %q: path is required", t.ID)
	}
	if !IsRenderableTabKind(t.Kind) {
		return fmt.Errorf("model: tab %q: unrecognised kind %q", t.ID, t.Kind)
	}
	if !IsJSONObject(t.State) {
		return fmt.Errorf("model: tab %q: state must be a JSON object", t.ID)
	}
	if t.WorkspaceID == nil || *t.WorkspaceID == "" {
		return fmt.Errorf("model: tab %q: workspaceId is required", t.ID)
	}
	return nil
}
