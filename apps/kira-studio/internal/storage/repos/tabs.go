package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

const tabsSelectAllSQL = `SELECT id, connection_id, path, kind, state_json, "order", active FROM tabs WHERE window_key = ? ORDER BY "order" ASC`

type TabsRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4); nil when constructed directly, which
	// falls back to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

// List returns windowKey's own tab set — every window keeps an independent list (P8 F6), scoped
// by the `tabs_window` index (windowKey, "order").
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

// Save replaces windowKey's own tab set in one transaction, rewriting `order` as the array index
// so the stored order is always dense (tabs.ts's replaceTabs). Every record is validated up front
// (P2 R2), the same envelope List() enforces on read: unlike List, which must tolerate legacy
// rows already on disk by dropping and logging, Save is the boundary where bad data should be
// refused outright rather than silently written and then vanish on the next restore.
//
// Scoping the DELETE by window_key is F6's fix: this used to be `DELETE FROM tabs` with no
// scope at all, so whichever window saved last erased every other open window's tabs outright —
// reproduced against a real two-client `-tags server` binary before this fix existed (P8 §1.3(c)).
//
// P21 round 3 performance finding 9: this used to DELETE every row for the window and re-INSERT
// every record regardless of what changed — tabs.ts's saveDebounced() calls this once a second
// while someone types in a console tab, so an unchanged 1 MB `state_json` for nine untouched tabs
// was rewritten every second purely because a tenth tab's own text changed. `id` is the table's
// own PRIMARY KEY (globally unique — every tab id is a crypto.randomUUID(), and the original code
// already assumed as much: an INSERT colliding with a row under a *different* window_key would
// have failed outright before this fix, same as it would now), so `ON CONFLICT(id) DO UPDATE`
// rewrites only the row for the record it was actually asked to write, and SQLite skips
// re-writing a page whose column values are byte-identical to what's already stored. The DELETE
// after it prunes only what fell out of `records` (a closed tab), never a row that survived.
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
			`INSERT INTO tabs (id, connection_id, path, kind, state_json, "order", active, window_key)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   connection_id = excluded.connection_id,
			   path          = excluded.path,
			   kind          = excluded.kind,
			   state_json    = excluded.state_json,
			   "order"       = excluded."order",
			   active        = excluded.active,
			   window_key    = excluded.window_key`,
			rec.ID, rec.ConnectionID, rec.Path, rec.Kind, string(rec.State), i, rec.Active, windowKey,
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
