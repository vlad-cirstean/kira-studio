package appstorage

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// LayoutSelectAllSQL is the `ui_layout` table's own "every stored leaf" query — each app's own
// LayoutRepo prepares it once (repos.New) and falls back to this same ad-hoc query when
// constructed directly (a test, or before that prepare step exists).
const LayoutSelectAllSQL = `SELECT key, value FROM ui_layout`

// ScanLayoutRows drains rows (or reports queryErr) into a key -> raw-JSON map. This is the part of
// each app's own LayoutRepo.scanAll that was byte-for-byte identical; the leaf vocabulary itself
// (Studio's five panel leaves vs Space's two) stays per-app, built from this map via
// appsettings.Leaf on top of this call.
func ScanLayoutRows(rows *sql.Rows, queryErr error) (map[string]json.RawMessage, error) {
	if queryErr != nil {
		return nil, fmt.Errorf("appstorage/layout: query: %w", queryErr)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("appstorage/layout: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("appstorage/layout: rows: %w", err)
	}
	return stored, nil
}
