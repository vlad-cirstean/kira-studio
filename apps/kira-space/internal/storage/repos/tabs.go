package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

const tabsSelectAllSQL = `SELECT id, path, kind, state_json, "order", active, workspace_id FROM tabs WHERE window_key = ? ORDER BY "order" ASC`

// TabsRepo is Kira Studio's own TabsRepo, minus its `connection_id` column — this app has no
// connections concept, and WorkspaceID is written NOT NULL (0002_p100_tabs_layout.sql), never
// scanned as sql.NullString.
type TabsRepo struct {
	DB *sql.DB

	selectAll *sql.Stmt
}

func (r *TabsRepo) List(windowKey string) ([]model.TabRecord, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if r.selectAll != nil {
		rows, err = r.selectAll.Query(windowKey)
	} else {
		rows, err = r.DB.Query(tabsSelectAllSQL, windowKey)
	}
	if err != nil {
		return nil, fmt.Errorf("repos/tabs: query: %w", err)
	}
	defer rows.Close()

	out := []model.TabRecord{}
	for rows.Next() {
		var (
			id, path, kind, stateJSON, workspaceID string
			order                                  int
			active                                 bool
		)
		if err := rows.Scan(&id, &path, &kind, &stateJSON, &order, &active, &workspaceID); err != nil {
			return nil, fmt.Errorf("repos/tabs: scan: %w", err)
		}
		if !model.IsJSONObject([]byte(stateJSON)) {
			slog.Warn("dropping tab row: state_json is not a JSON object", "scope", "storage/tabs", "id", id)
			continue
		}
		if !model.IsRenderableTabKind(kind) {
			slog.Warn("dropping tab row: unrecognised kind", "scope", "storage/tabs", "id", id, "kind", kind)
			continue
		}
		out = append(out, model.TabRecord{
			ID: id, Path: path, Kind: kind, State: json.RawMessage(stateJSON),
			Order: order, Active: active, WorkspaceID: &workspaceID,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/tabs: rows: %w", err)
	}
	return out, nil
}

// Save replaces windowKey's own tab set in one transaction — Kira Studio's own TabsRepo.Save,
// unchanged in shape (validate up front, upsert-then-prune by id, scoped to windowKey — F6's fix),
// minus the connection_id column.
func (r *TabsRepo) Save(windowKey string, records []model.TabRecord) error {
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

	keep := make([]string, 0, len(records))
	for i, rec := range records {
		keep = append(keep, rec.ID)
		if _, err := tx.Exec(
			`INSERT INTO tabs (id, path, kind, state_json, "order", active, window_key, workspace_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   path          = excluded.path,
			   kind          = excluded.kind,
			   state_json    = excluded.state_json,
			   "order"       = excluded."order",
			   active        = excluded.active,
			   window_key    = excluded.window_key,
			   workspace_id  = excluded.workspace_id`,
			rec.ID, rec.Path, rec.Kind, string(rec.State), i, rec.Active, windowKey, rec.WorkspaceID,
		); err != nil {
			return fmt.Errorf("repos/tabs: upsert %s: %w", rec.ID, err)
		}
	}

	if len(keep) == 0 {
		if _, err := tx.Exec(`DELETE FROM tabs WHERE window_key = ?`, windowKey); err != nil {
			return fmt.Errorf("repos/tabs: clear: %w", err)
		}
	} else {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keep)), ",")
		args := make([]any, 0, len(keep)+1)
		args = append(args, windowKey)
		for _, id := range keep {
			args = append(args, id)
		}
		if _, err := tx.Exec(
			fmt.Sprintf(`DELETE FROM tabs WHERE window_key = ? AND id NOT IN (%s)`, placeholders),
			args...,
		); err != nil {
			return fmt.Errorf("repos/tabs: prune: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/tabs: commit: %w", err)
	}
	return nil
}
