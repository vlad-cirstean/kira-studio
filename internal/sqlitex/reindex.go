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
