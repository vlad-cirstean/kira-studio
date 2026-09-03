package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// historyLimit mirrors filter-history.ts's HISTORY_LIMIT.
const historyLimit = 20

type FilterHistoryRepo struct {
	DB *sql.DB
}

// Record mirrors filter-history.ts's recordFilterUse. "I cleared the filter" (both nil) is not
// history and records nothing. The dedupe delete uses SQLite's IS operator (NULL-safe equality),
// replacing the TS build's isNull-vs-eq conditional with one SQL string (P52 §5.4's no
// per-call-shape rule) — re-recording an identical entry moves it to the top rather than
// duplicating it.
func (r *FilterHistoryRepo) Record(connectionID, path string, where *string, orderBy *model.SortSpec) error {
	if where == nil && orderBy == nil {
		return nil
	}

	var orderByJSON *string
	if orderBy != nil {
		encoded, err := json.Marshal(orderBy)
		if err != nil {
			return fmt.Errorf("repos/filter_history: encode orderBy: %w", err)
		}
		s := string(encoded)
		orderByJSON = &s
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos/filter_history: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(
		`DELETE FROM filter_history
		  WHERE connection_id = ? AND path = ? AND where_text IS ? AND order_by_json IS ?`,
		connectionID, path, where, orderByJSON,
	); err != nil {
		return fmt.Errorf("repos/filter_history: dedupe delete: %w", err)
	}

	if _, err := tx.Exec(
		`INSERT INTO filter_history (id, connection_id, path, where_text, order_by_json, used_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), connectionID, path, where, orderByJSON, model.NowISO(),
	); err != nil {
		return fmt.Errorf("repos/filter_history: insert: %w", err)
	}

	if _, err := tx.Exec(`
		DELETE FROM filter_history
		 WHERE connection_id = ? AND path = ?
		   AND id NOT IN (
		     SELECT id FROM filter_history
		      WHERE connection_id = ? AND path = ?
		      ORDER BY used_at DESC, rowid DESC
		      LIMIT ?
		   )
	`, connectionID, path, connectionID, path, historyLimit); err != nil {
		return fmt.Errorf("repos/filter_history: cap: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos/filter_history: commit: %w", err)
	}
	return nil
}

func (r *FilterHistoryRepo) List(connectionID, path string, limit int) ([]model.FilterHistoryEntry, error) {
	rows, err := r.DB.Query(
		`SELECT id, connection_id, path, where_text, order_by_json, used_at
		   FROM filter_history
		  WHERE connection_id = ? AND path = ?
		  ORDER BY used_at DESC, rowid DESC
		  LIMIT ?`,
		connectionID, path, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/filter_history: query: %w", err)
	}
	defer rows.Close()

	out := []model.FilterHistoryEntry{}
	for rows.Next() {
		var (
			e           model.FilterHistoryEntry
			whereText   sql.NullString
			orderByJSON sql.NullString
		)
		if err := rows.Scan(&e.ID, &e.ConnectionID, &e.Path, &whereText, &orderByJSON, &e.UsedAt); err != nil {
			return nil, fmt.Errorf("repos/filter_history: scan: %w", err)
		}
		if whereText.Valid {
			e.Where = &whereText.String
		}
		if orderByJSON.Valid {
			var spec model.SortSpec
			if err := json.Unmarshal([]byte(orderByJSON.String), &spec); err != nil {
				slog.Warn("dropping filter history row: order_by_json is not valid", "scope", "storage/filter-history", "id", e.ID)
				continue
			}
			e.OrderBy = &spec
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/filter_history: rows: %w", err)
	}
	return out, nil
}
