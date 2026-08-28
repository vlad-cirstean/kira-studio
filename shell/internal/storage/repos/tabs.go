package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// TabRecord's `State` stays raw JSON here — src/shared/domain/tabs.ts's per-kind discriminated
// union (data/definition/console/document/keyvalue/stream/browse) is renderer-side validation
// logic, not storage shape, and belongs with the rest of §7's typed bridge in P53/P56, not this
// walking skeleton.
type TabRecord struct {
	ID           string          `json:"id"`
	ConnectionID *string         `json:"connectionId"`
	Path         string          `json:"path"`
	Kind         string          `json:"kind"`
	State        json.RawMessage `json:"state"`
	Order        int             `json:"order"`
	Active       bool            `json:"active"`
}

// renderableTabKinds mirrors tabs.ts's RENDERABLE_TAB_KINDS (D18) — a row of any other kind is
// dropped on restore, logged, and not re-saved.
var renderableTabKinds = map[string]bool{
	"data": true, "definition": true, "console": true, "document": true,
	"keyvalue": true, "stream": true, "browse": true,
}

type TabsRepo struct {
	DB *sql.DB
}

func (r *TabsRepo) List() ([]TabRecord, error) {
	rows, err := r.DB.Query(
		`SELECT id, connection_id, path, kind, state_json, "order", active FROM tabs ORDER BY "order" ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/tabs: query: %w", err)
	}
	defer rows.Close()

	out := []TabRecord{}
	for rows.Next() {
		var (
			id, path, kind, stateJSON string
			connectionID              sql.NullString
			order                     int
			active                    bool
		)
		if err := rows.Scan(&id, &connectionID, &path, &kind, &stateJSON, &order, &active); err != nil {
			return nil, fmt.Errorf("repos/tabs: scan: %w", err)
		}
		if !json.Valid([]byte(stateJSON)) {
			continue // state_json is not valid JSON — dropped, mirroring tabs.ts.
		}
		// P19 legacy coercion: a tab persisted before the ddl->definition rename.
		if kind == "ddl" {
			kind = "definition"
		}
		if !renderableTabKinds[kind] {
			continue
		}
		rec := TabRecord{ID: id, Path: path, Kind: kind, State: json.RawMessage(stateJSON), Order: order, Active: active}
		if connectionID.Valid {
			v := connectionID.String
			rec.ConnectionID = &v
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/tabs: rows: %w", err)
	}
	return out, nil
}

// Save replaces the whole tab set in one transaction, rewriting `order` as the array index so
// the stored order is always dense (tabs.ts's replaceTabs).
func (r *TabsRepo) Save(records []TabRecord) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/tabs: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM tabs`); err != nil {
		return fmt.Errorf("repos/tabs: clear: %w", err)
	}
	for i, rec := range records {
		if _, err := tx.Exec(
			`INSERT INTO tabs (id, connection_id, path, kind, state_json, "order", active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			rec.ID, rec.ConnectionID, rec.Path, rec.Kind, string(rec.State), i, rec.Active,
		); err != nil {
			return fmt.Errorf("repos/tabs: insert %s: %w", rec.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/tabs: commit: %w", err)
	}
	return nil
}
