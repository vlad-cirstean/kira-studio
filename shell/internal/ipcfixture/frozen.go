// frozen.go is P58f §4.3(d)'s per-adapter named non-determinism list, re-derived from the
// TypeScript specs at port time: every frozen field is named here, in one place, so a new
// non-determinism produces a diff rather than a silent freeze (D13's own §5.6 second guard).
package ipcfixture

import "github.com/kirathecat/kira-studio/shell/internal/storage/model"

// FrozenHost/FrozenPort/FrozenCreatedAt/FrozenUpdatedAt are the values every committed fixture
// freezes a connection summary's own container-assigned fields to — Testcontainers hands out a
// fresh host port every run, and the row's timestamps are wall-clock, so an unfrozen fixture would
// churn on every regeneration for reasons no reviewer could act on.
const (
	FrozenHost      = "fixture-host"
	FrozenPort      = 0
	FrozenCreatedAt = "2024-01-01T00:00:00.000Z"
	FrozenUpdatedAt = "2024-01-01T00:00:00.000Z"
)

// FrozenConnectionSummary is the shape every committed fixture's connectionsList/connectionsConnect
// snapshot freezes a model.ConnectionSummary into — field order matches the committed fixtures
// exactly (id, sortOrder, createdAt, updatedAt, name, kind, ...), which is the TypeScript spec's
// own connectionSummaryOf() output order, not model.ConnectionSummary's Go field order (the two
// differ; this type exists so the JSON this package writes doesn't have to care).
type FrozenConnectionSummary struct {
	ID                string         `json:"id"`
	SortOrder         int            `json:"sortOrder"`
	CreatedAt         string         `json:"createdAt"`
	UpdatedAt         string         `json:"updatedAt"`
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	Color             string         `json:"color"`
	Mode              string         `json:"mode"`
	ReadOnly          bool           `json:"readOnly"`
	Host              *string        `json:"host"`
	Port              *int           `json:"port"`
	Database          *string        `json:"database"`
	Username          *string        `json:"username"`
	URI               *string        `json:"uri"`
	Options           map[string]any `json:"options"`
	Preconnect        *string        `json:"preconnect"`
	PreconnectSidecar bool           `json:"preconnectSidecar"`
}

// FreezeConnectionSummary applies the frozen fields above to a real model.ConnectionSummary.
func FreezeConnectionSummary(s model.ConnectionSummary) FrozenConnectionSummary {
	host := FrozenHost
	port := FrozenPort
	options := s.Options
	if options == nil {
		options = map[string]any{}
	}
	return FrozenConnectionSummary{
		ID: s.ID, SortOrder: s.SortOrder, CreatedAt: FrozenCreatedAt, UpdatedAt: FrozenUpdatedAt,
		Name: s.Name, Kind: s.Kind, Color: s.Color, Mode: s.Mode, ReadOnly: s.ReadOnly,
		Host: &host, Port: &port, Database: s.Database, Username: s.Username, URI: s.URI,
		Options: options, Preconnect: s.Preconnect, PreconnectSidecar: s.PreconnectSidecar,
	}
}

// FreezeConnectionState zeroes Since (§4.3(d): "since -> 0") the same way FreezeConnectionSummary
// zeroes a container's host/port — the connect timestamp is wall-clock, not a fixture-worthy value.
func FreezeConnectionState(s model.ConnectionState) model.ConnectionState {
	s.Since = 0
	return s
}

// continuationTokenPlaceholder is what MaskContinuationTokens substitutes for a keyset page's
// nextToken/prevToken.
//
// This is a P58f-port-time finding, not carried over from any TypeScript spec (§4.3(d) is
// otherwise a re-derivation of frozen fields the old specs already named): a keyset continuation
// token is adapters.EncodePageToken's base64(json({v, k, f})), where f is
// adapters.RequestFingerprint — sha1 of a Go struct (mysqlfamily/read.go's own {Path
// QualifiedName, Projection, Filter, Sort, PageSize}) marshaled by encoding/json. The deleted
// TypeScript engine's sql-text.ts computed the same conceptual fingerprint from its own JS object
// shape, and nothing requires the two encodings to serialize to identical bytes — sqltext.go's own
// doc comment on RequestFingerprint already says so: "Deterministic within a process is all that
// is required — a token is only ever decoded by the process that minted it." A frontend spec never
// re-derives this value either; it only ever passes a captured token back verbatim. So the token's
// *shape* (present, non-empty, base64) is what a fixture can usefully assert; its exact bytes are
// not portable across the two engines and are masked out here rather than compared.
const continuationTokenPlaceholder = "<token>"

// MaskContinuationTokens walks a JSON value already decoded into any (map[string]any/[]any/
// primitives, e.g. via json.Unmarshal) and replaces every non-null "nextToken"/"prevToken" string
// value with continuationTokenPlaceholder, in place recursively.
func MaskContinuationTokens(v any) {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if (k == "nextToken" || k == "prevToken") && val != nil {
				t[k] = continuationTokenPlaceholder
				continue
			}
			MaskContinuationTokens(val)
		}
	case []any:
		for _, item := range t {
			MaskContinuationTokens(item)
		}
	}
}
