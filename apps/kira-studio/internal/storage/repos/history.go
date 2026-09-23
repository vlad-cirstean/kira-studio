package repos

import (
	"database/sql"
	"fmt"
)

// historyTable is the read/adopt/orphan-sweep/single-delete shape grpc_history.go and
// response_history.go each rebuilt per table (T2-14): identical SQL, differing only in table
// name, the timestamp column ORDER BY/tiebreak against (called_at vs. sent_at), the summary
// column list, and the entry type T decodes into. Record/Get/Clear stay outside this generic:
// each table's own Record applies a genuinely different cap policy (D6 vs. D11) and Get decodes a
// differently-shaped snapshot_json — folding either in would hide real per-table policy behind a
// shared shape that does not actually fit.
type historyTable[T any] struct {
	// table is the SQL table name; scope is the shorter name every error string here is already
	// prefixed with ("grpc_history" / "response_history" — kept distinct from table so error text
	// stays exactly what it was before this hoist).
	table, scope string
	timeColumn   string // "called_at" / "sent_at"
	columns      string // the summary SELECT list (every column but snapshot_json)
	scan         func(rowScanner) (T, error)
}

// List is the summary projection, newest first — ≤ the caller's own per-scope cap by construction
// (each table's own Record trim).
func (h historyTable[T]) List(db *sql.DB, scopeKey string) ([]T, error) {
	rows, err := db.Query(
		`SELECT `+h.columns+`
		   FROM `+h.table+`
		  WHERE scope_key = ?
		  ORDER BY `+h.timeColumn+` DESC, rowid DESC`,
		scopeKey,
	)
	if err != nil {
		return nil, fmt.Errorf("repos/%s: query list: %w", h.scope, err)
	}
	defer rows.Close()

	out := []T{}
	for rows.Next() {
		e, err := h.scan(rows)
		if err != nil {
			return nil, fmt.Errorf("repos/%s: scan list: %w", h.scope, err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/%s: rows: %w", h.scope, err)
	}
	return out, nil
}

// Delete removes one entry.
func (h historyTable[T]) Delete(db *sql.DB, id string) error {
	if _, err := db.Exec(`DELETE FROM `+h.table+` WHERE id = ?`, id); err != nil {
		return fmt.Errorf("repos/%s: delete: %w", h.scope, err)
	}
	return nil
}

// Adopt moves a scratch tab's history onto a newly-saved request — one UPDATE, scope follows via
// the generated column.
func (h historyTable[T]) Adopt(db *sql.DB, tabID, itemID string) (int, error) {
	res, err := db.Exec(
		`UPDATE `+h.table+` SET item_id = ? WHERE item_id IS NULL AND tab_id = ?`,
		itemID, tabID,
	)
	if err != nil {
		return 0, fmt.Errorf("repos/%s: adopt: %w", h.scope, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("repos/%s: adopt rows affected: %w", h.scope, err)
	}
	return int(n), nil
}

// SweepOrphans deletes a scratch tab's history once its tab is gone — run once at launch.
func (h historyTable[T]) SweepOrphans(db *sql.DB) error {
	if _, err := db.Exec(
		`DELETE FROM ` + h.table + `
		  WHERE item_id IS NULL AND tab_id NOT IN (SELECT id FROM tabs)`,
	); err != nil {
		return fmt.Errorf("repos/%s: sweep orphans: %w", h.scope, err)
	}
	return nil
}
