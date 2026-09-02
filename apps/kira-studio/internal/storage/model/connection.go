package model

// ConnectionFields is the shape both ConnectionsRepo.Insert/Update accept and ConnectionSummary
// embeds — packages/shared/domain/connection.ts's connectionFieldsSchema, minus `password` (D9: no
// password field anywhere in this package, enforced by the type itself, same as the TS build's
// `.omit({password: true})`).
type ConnectionFields struct {
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
	// P18 (v1.1) D18: runs the connection's own EXPLAIN before every SELECT a console run issues
	// on it, and warns when the threshold or a structural issue fires (never blocks). A first-class
	// column, not an options_json key — see the migration's own comment for why.
	AutoExplain bool `json:"autoExplain"`
}

// ConnectionSummary mirrors packages/shared/domain/connection.ts's connectionSummarySchema.
// ConnectionFields is embedded (not nested) so its fields JSON-inline into this struct's own
// object, matching the TS schema's flat shape.
type ConnectionSummary struct {
	ID string `json:"id"`
	ConnectionFields
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// ConnectionState mirrors packages/shared/domain/connection.ts's connectionStateSchema. It is kept
// in-memory by the connections service (not read from a table) — listed here only as the shared
// wire type the repo's callers also use.
type ConnectionState struct {
	ConnectionID  string  `json:"connectionId"`
	Status        string  `json:"status"`
	ServerVersion *string `json:"serverVersion"`
	Error         *string `json:"error"`
	Since         int64   `json:"since"`
	Caps          any     `json:"caps"`
}

// connectionKinds mirrors connection.ts's connectionKindSchema — all v1 kinds.
var connectionKinds = map[string]bool{
	"postgres": true, "mariadb": true, "mysql": true, "sqlite": true, "clickhouse": true,
	"mongodb": true, "redis": true, "kafka": true, "sqs": true, "s3": true,
}

// connectionColors mirrors connection.ts's connectionColorSchema — the whole storable set, not
// CONNECTION_COLOR_CHOICES (the picker's offered subset). P42 F27: a connection saved with a
// retired colour must keep parsing, listing and painting its own rail, so trimming this set to
// match the picker would silently corrupt existing rows.
var connectionColors = map[string]bool{
	"none": true, "red": true, "orange": true, "amber": true, "olive": true, "green": true,
	"teal": true, "cyan": true, "blue": true, "indigo": true, "violet": true, "magenta": true,
	"grey": true,
}

// ValidConnectionKind mirrors connection.ts's connectionKindSchema.
func ValidConnectionKind(v string) bool { return connectionKinds[v] }

// ValidConnectionColor mirrors connection.ts's connectionColorSchema (the full 13-colour set).
func ValidConnectionColor(v string) bool { return connectionColors[v] }

// ValidConnectionMode mirrors connection.ts's connectionModeSchema.
func ValidConnectionMode(v string) bool { return v == "fields" || v == "uri" }
