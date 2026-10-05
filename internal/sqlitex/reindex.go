package sqlitex

import (
	"database/sql"
	"fmt"
)

// ReindexSortOrder rewrites a sibling set's sort_order dense, 0..n-1, in the order the rows
// already have — the read-ids/loop-update shape three repos (Studio's collections and variables,
// each with a different sibling scope) ran identically (P107 I2-31). selectSQL must return exactly
// one string column (the row id) ordered the way the new sort_order should follow; updateSQL takes
// (order, id) as its two placeholders, in that order.
func ReindexSortOrder(tx *sql.Tx, selectSQL, updateSQL string, args ...any) error {
	rows, err := tx.Query(selectSQL, args...)
	if err != nil {
		return fmt.Errorf("sqlitex: reindex: read siblings: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("sqlitex: reindex: scan sibling: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("sqlitex: reindex: sibling rows: %w", err)
	}
	rows.Close()

	for order, id := range ids {
		if _, err := tx.Exec(updateSQL, order, id); err != nil {
			return fmt.Errorf("sqlitex: reindex %s: %w", id, err)
		}
	}
	return nil
}

// ReorderSortOrder applies a caller-supplied order to one sibling set and rewrites the whole set's
// sort_order dense, 0..n-1: ids first, in the given order, then every row ids leaves out in its
// existing order (a window working from a stale list never collides with a row created since).
// selectSQL has ReindexSortOrder's shape and must select exactly the set's rows; an id outside
// that set, or listed twice, is an error rather than a silent write to another set's row.
func ReorderSortOrder(tx *sql.Tx, selectSQL, updateSQL string, ids []string, args ...any) error {
	rows, err := tx.Query(selectSQL, args...)
	if err != nil {
		return fmt.Errorf("sqlitex: reorder: read siblings: %w", err)
	}
	existing := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("sqlitex: reorder: scan sibling: %w", err)
		}
		existing = append(existing, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("sqlitex: reorder: sibling rows: %w", err)
	}
	rows.Close()

	inSet := make(map[string]bool, len(existing))
	for _, id := range existing {
		inSet[id] = true
	}
	ordered := make([]string, 0, len(existing))
	placed := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !inSet[id] {
			return fmt.Errorf("sqlitex: reorder: %s is not in this set", id)
		}
		if placed[id] {
			return fmt.Errorf("sqlitex: reorder: %s listed twice", id)
		}
		placed[id] = true
		ordered = append(ordered, id)
	}
	for _, id := range existing {
		if !placed[id] {
			ordered = append(ordered, id)
		}
	}
	for order, id := range ordered {
		if _, err := tx.Exec(updateSQL, order, id); err != nil {
			return fmt.Errorf("sqlitex: reorder %s: %w", id, err)
		}
	}
	return nil
}
