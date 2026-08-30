package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

const connectionSelectColumns = `
	id, name, kind, color, mode, read_only, host, port, database, username, uri,
	options_json, preconnect, preconnect_sidecar, sort_order, created_at, updated_at
`

type ConnectionsRepo struct {
	DB *sql.DB
}

// rowScanner is satisfied by both *sql.Rows and *sql.Row, letting scanConnectionRow serve both
// List (many rows) and Get (one row) with the same column layout and validation.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanConnectionRow scans one row in connectionSelectColumns's order and validates it the same
// way connections.ts's parseRow does: a hand-mangled row is dropped (nil, nil), not propagated —
// unlike settings/layout, a bad connection row must not make the whole app unlaunchable.
func scanConnectionRow(row rowScanner) (*model.ConnectionSummary, error) {
	var (
		c                             model.ConnectionSummary
		host, database, username, uri sql.NullString
		port                          sql.NullInt64
		options                       sql.NullString
		preconnect                    sql.NullString
		readOnly, sidecar             int
	)
	if err := row.Scan(
		&c.ID, &c.Name, &c.Kind, &c.Color, &c.Mode, &readOnly, &host, &port, &database,
		&username, &uri, &options, &preconnect, &sidecar, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}

	if !model.ValidConnectionKind(c.Kind) {
		slog.Warn("dropping connection row: unrecognised kind", "scope", "storage/connections", "id", c.ID, "kind", c.Kind)
		return nil, nil
	}
	if !model.ValidConnectionColor(c.Color) {
		slog.Warn("dropping connection row: unrecognised color", "scope", "storage/connections", "id", c.ID, "color", c.Color)
		return nil, nil
	}
	if !model.ValidConnectionMode(c.Mode) {
		slog.Warn("dropping connection row: unrecognised mode", "scope", "storage/connections", "id", c.ID, "mode", c.Mode)
		return nil, nil
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

	c.Options = map[string]any{}
	if options.Valid && options.String != "" {
		if err := json.Unmarshal([]byte(options.String), &c.Options); err != nil {
			slog.Warn("dropping connection row: options_json is not valid JSON", "scope", "storage/connections", "id", c.ID)
			return nil, nil
		}
	}
	return &c, nil
}

// List orders by sort_order ASC, name ASC (the name tiebreak connections.ts's own listConnections
// applies — two rows sharing a sort_order must not come back in arbitrary order once Reorder
// exists) and never selects password.
func (r *ConnectionsRepo) List() ([]model.ConnectionSummary, error) {
	rows, err := r.DB.Query(`SELECT ` + connectionSelectColumns + ` FROM connections ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, fmt.Errorf("repos/connections: query: %w", err)
	}
	defer rows.Close()

	out := []model.ConnectionSummary{}
	for rows.Next() {
		c, err := scanConnectionRow(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/connections: scan: %w", err)
		}
		if c != nil {
			out = append(out, *c)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/connections: rows: %w", err)
	}
	return out, nil
}

// KindOf satisfies adapterhost.KindLookup — the router's per-connection native/Node-served
// routing decision. A plain DB read for now, not the connections service's own in-memory state
// map: main.go constructs the router before connections.Service exists (the router is one of
// that service's own Deps), so there is no earlier in-memory source to prefer yet. Worth
// revisiting once nativeKinds is non-empty and this is on every data op's hot path (M5).
func (r *ConnectionsRepo) KindOf(connID string) (string, bool) {
	summary, err := r.Get(connID)
	if err != nil || summary == nil {
		return "", false
	}
	return summary.Kind, true
}

// Get returns (nil, nil) when no row with this id exists (or the row failed validation).
func (r *ConnectionsRepo) Get(connID string) (*model.ConnectionSummary, error) {
	row := r.DB.QueryRow(`SELECT `+connectionSelectColumns+` FROM connections WHERE id = ?`, connID)
	c, err := scanConnectionRow(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("repos/connections: get %s: %w", connID, err)
	}
	return c, nil
}

// Insert computes the next sort_order inside the same transaction as the insert (unlike
// connections.ts's two separate statements — under this app's SetMaxOpenConns(1) a transaction
// costs nothing and removes the race outright), then returns the row via Get.
func (r *ConnectionsRepo) Insert(connID string, f model.ConnectionFields, createdAt string) (model.ConnectionSummary, error) {
	optionsJSON, err := json.Marshal(f.Options)
	if err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: encode options: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var sortOrder int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connections`).Scan(&sortOrder); err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: next sort order: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO connections (
			id, name, kind, color, mode, read_only, host, port, database, username, uri,
			options_json, preconnect, preconnect_sidecar, created_at, updated_at, sort_order
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		connID, f.Name, f.Kind, f.Color, f.Mode, boolToInt(f.ReadOnly), f.Host, f.Port, f.Database,
		f.Username, f.URI, string(optionsJSON), f.Preconnect, boolToInt(f.PreconnectSidecar),
		createdAt, createdAt, sortOrder,
	); err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: insert %s: %w", connID, err)
	}
	if err := tx.Commit(); err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: commit: %w", err)
	}

	created, err := r.Get(connID)
	if err != nil {
		return model.ConnectionSummary{}, err
	}
	if created == nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: row %s not readable after insert", connID)
	}
	return *created, nil
}

func (r *ConnectionsRepo) Update(connID string, f model.ConnectionFields, updatedAt string) (model.ConnectionSummary, error) {
	optionsJSON, err := json.Marshal(f.Options)
	if err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: encode options: %w", err)
	}
	if _, err := r.DB.Exec(`
		UPDATE connections
		   SET name = ?, kind = ?, color = ?, mode = ?, read_only = ?, host = ?, port = ?,
		       database = ?, username = ?, uri = ?, options_json = ?, preconnect = ?,
		       preconnect_sidecar = ?, updated_at = ?
		 WHERE id = ?
	`,
		f.Name, f.Kind, f.Color, f.Mode, boolToInt(f.ReadOnly), f.Host, f.Port, f.Database,
		f.Username, f.URI, string(optionsJSON), f.Preconnect, boolToInt(f.PreconnectSidecar),
		updatedAt, connID,
	); err != nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: update %s: %w", connID, err)
	}

	updated, err := r.Get(connID)
	if err != nil {
		return model.ConnectionSummary{}, err
	}
	if updated == nil {
		return model.ConnectionSummary{}, fmt.Errorf("repos/connections: row %s not found after update", connID)
	}
	return *updated, nil
}

// Delete relies on the schema's ON DELETE CASCADE (connections.go's referencing tables:
// saved_queries, metadata_cache, connection_tree_filters, filter_history, and op_log's
// ON DELETE SET NULL) — no manual cleanup needed here.
func (r *ConnectionsRepo) Delete(connID string) error {
	if _, err := r.DB.Exec(`DELETE FROM connections WHERE id = ?`, connID); err != nil {
		return fmt.Errorf("repos/connections: delete %s: %w", connID, err)
	}
	return nil
}

// Reorder writes sort_order = index for each id in one transaction, then returns List().
func (r *ConnectionsRepo) Reorder(ids []string) ([]model.ConnectionSummary, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, fmt.Errorf("repos/connections: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	for i, connID := range ids {
		if _, err := tx.Exec(`UPDATE connections SET sort_order = ? WHERE id = ?`, i, connID); err != nil {
			return nil, fmt.Errorf("repos/connections: reorder %s: %w", connID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("repos/connections: commit reorder: %w", err)
	}
	return r.List()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
