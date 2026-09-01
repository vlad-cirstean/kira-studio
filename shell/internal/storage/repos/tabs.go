package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

const tabsSelectAllSQL = `SELECT id, connection_id, path, kind, state_json, "order", active FROM tabs ORDER BY "order" ASC`

type TabsRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4); nil when constructed directly, which
	// falls back to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

func (r *TabsRepo) List() ([]model.TabRecord, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if r.selectAll != nil {
		rows, err = r.selectAll.Query()
	} else {
		rows, err = r.DB.Query(tabsSelectAllSQL)
	}
	if err != nil {
		return nil, fmt.Errorf("repos/tabs: query: %w", err)
	}
	defer rows.Close()

	out := []model.TabRecord{}
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
		if !model.IsJSONObject([]byte(stateJSON)) {
			slog.Warn("dropping tab row: state_json is not a JSON object", "scope", "storage/tabs", "id", id)
			continue
		}
		// No 'ddl'->'definition' coercion here (P53 §3.1: dropped alongside ops.go's, not
		// ported): the renderer has not written 'ddl' since P19, and a fresh kira.db cannot
		// contain one, so an unrecognised kind is simply dropped like any other.
		if !model.IsRenderableTabKind(kind) {
			slog.Warn("dropping tab row: unrecognised kind", "scope", "storage/tabs", "id", id, "kind", kind)
			continue
		}
		rec := model.TabRecord{ID: id, Path: path, Kind: kind, State: json.RawMessage(stateJSON), Order: order, Active: active}
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
// the stored order is always dense (tabs.ts's replaceTabs). Every record is validated up front
// (P2 R2), the same envelope List() enforces on read: unlike List, which must tolerate legacy
// rows already on disk by dropping and logging, Save is the boundary where bad data should be
// refused outright rather than silently written and then vanish on the next restore.
func (r *TabsRepo) Save(records []model.TabRecord) error {
	for i, rec := range records {
		if err := rec.Validate(); err != nil {
			return fmt.Errorf("repos/tabs: record %d: %w", i, err)
		}
	}

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
