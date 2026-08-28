package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// ConnectionSummary mirrors src/shared/domain/connection.ts's connectionSummarySchema — note the
// deliberate absence of a password field (D9), enforced here by the type itself, same as the TS
// build's `.omit({password: true})`.
type ConnectionSummary struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Kind              string          `json:"kind"`
	Color             string          `json:"color"`
	Mode              string          `json:"mode"`
	ReadOnly          bool            `json:"readOnly"`
	Host              *string         `json:"host"`
	Port              *int            `json:"port"`
	Database          *string         `json:"database"`
	Username          *string         `json:"username"`
	URI               *string         `json:"uri"`
	Options           json.RawMessage `json:"options"`
	Preconnect        *string         `json:"preconnect"`
	PreconnectSidecar bool            `json:"preconnectSidecar"`
	SortOrder         int             `json:"sortOrder"`
	CreatedAt         string          `json:"createdAt"`
	UpdatedAt         string          `json:"updatedAt"`
}

// ConnectionState mirrors src/shared/domain/connection.ts's connectionStateSchema. It is kept
// in-memory by the connections service (not read from this table) — listed here only as the
// shared wire type the repo's callers also use.
type ConnectionState struct {
	ConnectionID  string          `json:"connectionId"`
	Status        string          `json:"status"`
	ServerVersion *string         `json:"serverVersion"`
	Error         *string         `json:"error"`
	Since         int64           `json:"since"`
	Caps          json.RawMessage `json:"caps"`
}

type ConnectionsRepo struct {
	DB *sql.DB
}

func (r *ConnectionsRepo) List() ([]ConnectionSummary, error) {
	rows, err := r.DB.Query(`
		SELECT id, name, kind, color, mode, read_only, host, port, database, username, uri,
		       options_json, preconnect, preconnect_sidecar, sort_order, created_at, updated_at
		  FROM connections
		 ORDER BY sort_order ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("repos/connections: query: %w", err)
	}
	defer rows.Close()

	out := []ConnectionSummary{}
	for rows.Next() {
		var (
			c                             ConnectionSummary
			host, database, username, uri sql.NullString
			port                          sql.NullInt64
			options                       sql.NullString
			preconnect                    sql.NullString
			readOnly, sidecar             int
		)
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Kind, &c.Color, &c.Mode, &readOnly, &host, &port, &database,
			&username, &uri, &options, &preconnect, &sidecar, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("repos/connections: scan: %w", err)
		}
		c.ReadOnly = readOnly != 0
		c.PreconnectSidecar = sidecar != 0
		if host.Valid {
			c.Host = &host.String
		}
		if port.Valid {
			p := int(port.Int64)
			c.Port = &p
		}
		if database.Valid {
			c.Database = &database.String
		}
		if username.Valid {
			c.Username = &username.String
		}
		if uri.Valid {
			c.URI = &uri.String
		}
		if preconnect.Valid {
			c.Preconnect = &preconnect.String
		}
		if options.Valid {
			c.Options = json.RawMessage(options.String)
		} else {
			c.Options = json.RawMessage("{}")
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/connections: rows: %w", err)
	}
	return out, nil
}
