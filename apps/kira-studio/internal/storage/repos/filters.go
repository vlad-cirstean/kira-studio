package repos

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

type FiltersRepo struct {
	DB *sql.DB
}

func (r *FiltersRepo) List(connectionID string) (model.TreeVisibility, error) {
	rows, err := r.DB.Query(
		`SELECT scope, value FROM connection_tree_filters WHERE connection_id = ?`, connectionID,
	)
	if err != nil {
		return model.TreeVisibility{}, fmt.Errorf("repos/filters: query: %w", err)
	}
	defer rows.Close()

	out := model.EmptyVisibility()
	for rows.Next() {
		var scope, value string
		if err := rows.Scan(&scope, &value); err != nil {
			return model.TreeVisibility{}, fmt.Errorf("repos/filters: scan: %w", err)
		}
		switch scope {
		case "kind":
			out.HiddenKinds = append(out.HiddenKinds, value)
		case "path":
			out.HiddenPaths = append(out.HiddenPaths, value)
		default:
			slog.Warn("dropping unrecognised filter scope", "scope", "storage/filters", "connectionId", connectionID, "rowScope", scope)
		}
	}
	if err := rows.Err(); err != nil {
		return model.TreeVisibility{}, fmt.Errorf("repos/filters: rows: %w", err)
	}
	return out, nil
}

// Replace is delete-all + insert, one transaction (filters.ts's replaceVisibility): the dialog
// edits a whole set and saves it. INSERT OR IGNORE (D10) absorbs a duplicate value in the input —
// the primary key is (connection_id, scope, value) and the payload is a set, so a repeat is a
// no-op rather than an error.
func (r *FiltersRepo) Replace(connectionID string, v model.TreeVisibility) (model.TreeVisibility, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.TreeVisibility{}, fmt.Errorf("repos/filters: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM connection_tree_filters WHERE connection_id = ?`, connectionID); err != nil {
		return model.TreeVisibility{}, fmt.Errorf("repos/filters: clear: %w", err)
	}
	for _, kind := range v.HiddenKinds {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO connection_tree_filters (connection_id, scope, value) VALUES (?, 'kind', ?)`,
			connectionID, kind,
		); err != nil {
			return model.TreeVisibility{}, fmt.Errorf("repos/filters: insert kind %s: %w", kind, err)
		}
	}
	for _, path := range v.HiddenPaths {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO connection_tree_filters (connection_id, scope, value) VALUES (?, 'path', ?)`,
			connectionID, path,
		); err != nil {
			return model.TreeVisibility{}, fmt.Errorf("repos/filters: insert path %s: %w", path, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return model.TreeVisibility{}, fmt.Errorf("repos/filters: commit: %w", err)
	}
	return r.List(connectionID)
}
