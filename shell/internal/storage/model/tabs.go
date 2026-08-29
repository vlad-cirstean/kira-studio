package model

import "encoding/json"

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
