package model

import (
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// TabRecord's `State` stays raw JSON here — packages/shared/domain/tabs.ts's per-kind discriminated
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
	// WorkspaceID is C5 §3.1/§4.2's own tab-isolation dimension: nil for every studio/api tab
	// (workspaceKeyOf's own `??` fallback then derives the workspace from Kind, exactly as
	// today), "repo:<code_repos.id>" for a tab scoped to that repository's own workspace.
	WorkspaceID *string `json:"workspaceId"`
}

// RenderableTabKinds mirrors tabs.ts's RENDERABLE_TAB_KINDS — a row of any other kind is dropped
// on restore, logged, and not re-saved. Note 'ddl' is deliberately absent (P52 §4.3 / P53 §3.1):
// the legacy 'ddl'->'definition' coercion is dropped, not ported.
var RenderableTabKinds = map[string]bool{
	"data": true, "definition": true, "console": true, "document": true,
	"keyvalue": true, "stream": true, "browse": true,
	// P2: the first Http-mode tab kind (§2 F1) — this list is the one of the four kind
	// vocabularies TypeScript's own exhaustiveness checks can't catch a miss on (D10's parity test).
	"http-request": true,
	// P11 D2: the second kind inside the 'http' mode.
	"grpc-request": true,
	// P17 D16: the third kind inside the 'api' mode — one collection's or one environment's
	// variable set, opened as a tab. This is the exact vocabulary F8 warns is easy to miss: a row
	// of this kind is silently dropped on restore if this line is forgotten.
	"variable-set": true,
	// P28 D16(c): the fourth kind inside the 'api' mode — the environment list, where an
	// environment is created/renamed/duplicated/deleted/reordered. Same F8 warning as the line
	// above: forget this and a row of this kind is silently dropped on restore.
	"environments": true,
	// P83 §7.1: an embedded shell tab. Never actually reaches restore (persistableTabs() filters
	// it out before save, tabs.ts:132) — still required here, same F8 warning: the parity test
	// (go-ts-vocabulary-parity.spec.ts) demands a vocabulary complete regardless of what currently
	// reaches it.
	"terminal": true,
	// P103 Part 2 (§5.1): repo-graph/repo-file/repo-diff/repo-multi-diff removed — P100 Part 2
	// moved the whole repo workspace to Kira Space, so this app can no longer produce a tab of any
	// of those four kinds. A pre-P100 row of one of them still in a user's `tabs` table now drops
	// with a `warn` on restore (repos/tabs.go), which is this file's own documented posture for any
	// unrecognised kind — no migration needed.
}

// IsRenderableTabKind reports whether kind is one of the renderable tab kinds.
func IsRenderableTabKind(kind string) bool {
	return RenderableTabKinds[kind]
}

// IsJSONObject reports whether raw is valid JSON whose top-level value is an object — tabs.ts's
// row.state must round-trip a Record<...>-shaped state, never a bare array or scalar.
func IsJSONObject(raw []byte) bool {
	return appstorage.IsJSONObject(raw)
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
	// P103 Part 2: repoTabKinds used to be a multi-entry subset (the four repo-* kinds plus
	// terminal); with those four gone, 'terminal' is the only kind left that needs a workspaceId
	// (every other kind derives its workspace from TAB_KIND_MODE instead), so this collapses to a
	// single equality check rather than keeping a one-member map around.
	if t.Kind == "terminal" && (t.WorkspaceID == nil || *t.WorkspaceID == "") {
		return fmt.Errorf("model: tab %q: kind %q requires a workspaceId", t.ID, t.Kind)
	}
	return nil
}
