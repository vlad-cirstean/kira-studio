package model

import (
	"encoding/json"
	"fmt"
)

// TabRecord's `State` stays raw JSON here — src/shared/domain/tabs.ts's per-kind discriminated
// union (data/definition/console/document/keyvalue/stream/browse) is renderer-side validation
// logic, not storage shape (D3). Go validates only the envelope it owns: kind is in
// RenderableTabKinds and State parses as a JSON object; per-kind shape and forward-compatible
// defaults stay renderer-side.
type TabRecord struct {
	ID           string          `json:"id"`
	ConnectionID *string         `json:"connectionId"`
	Path         string          `json:"path"`
	Kind         string          `json:"kind"`
	State        json.RawMessage `json:"state"`
	Order        int             `json:"order"`
	Active       bool            `json:"active"`
}

// RenderableTabKinds mirrors tabs.ts's RENDERABLE_TAB_KINDS — a row of any other kind is dropped
// on restore, logged, and not re-saved. Note 'ddl' is deliberately absent (P52 §4.3 / P53 §3.1):
// the legacy 'ddl'->'definition' coercion is dropped, not ported.
var RenderableTabKinds = map[string]bool{
	"data": true, "definition": true, "console": true, "document": true,
	"keyvalue": true, "stream": true, "browse": true,
}

// IsRenderableTabKind reports whether kind is one of the seven renderable tab kinds.
func IsRenderableTabKind(kind string) bool {
	return RenderableTabKinds[kind]
}

// IsJSONObject reports whether raw is valid JSON whose top-level value is an object — tabs.ts's
// row.state must round-trip a Record<...>-shaped state, never a bare array or scalar.
func IsJSONObject(raw []byte) bool {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return false
	}
	_, ok := v.(map[string]any)
	return ok
}

// Validate asserts the same envelope repos.TabsRepo.List already enforces on read (kind is
// renderable, state is a JSON object), plus the non-empty identity fields no SQL constraint
// covers (P2 R2: Save previously wrote records unvalidated, so a bad row round-tripped silently —
// it persisted, then vanished on the next List() with nothing at the write site to say why).
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
	return nil
}
