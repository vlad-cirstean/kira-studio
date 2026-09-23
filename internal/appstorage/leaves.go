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

// ScanLeafRows drains rows (or reports queryErr) into a key -> raw-JSON map. Both apps' layout and
// settings tables share this exact shape (one JSON-valued row per leaf key) and this scan loop was
// byte-for-byte identical across all four (P107 I2-1); the leaf vocabulary and per-key defaults
// stay per-repo, built from this map.
func ScanLeafRows(rows *sql.Rows, queryErr error) (map[string]json.RawMessage, error) {
	if queryErr != nil {
		return nil, fmt.Errorf("appstorage: leaf query: %w", queryErr)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("appstorage: leaf scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("appstorage: leaf rows: %w", err)
	}
	return stored, nil
}

// UpdateLeaves runs the tx/read/apply/commit frame every leaf-table Set repeats (both apps' own
// layout and settings repos, P107 I2-1): begin a transaction, scan the leaves currently stored
// (via selectAll when the caller prepared one, an ad-hoc query against fallbackSQL otherwise
// inside the same tx), hand tx and the scanned map to apply — which merges the patch and upserts
// whatever leaves it decides to write — then commit. apply's own merge/upsert logic stays
// per-repo: a layout Set rewrites every leaf from a full merged model, a settings Set upserts only
// the leaves its patch actually touched and re-reads via its own GetAll afterwards — both fit this
// one frame.
func UpdateLeaves(db *sql.DB, selectAll *sql.Stmt, fallbackSQL string, apply func(tx *sql.Tx, stored map[string]json.RawMessage) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("appstorage: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var rows *sql.Rows
	if selectAll != nil {
		rows, err = tx.Stmt(selectAll).Query()
	} else {
		rows, err = tx.Query(fallbackSQL)
	}
	stored, err := ScanLeafRows(rows, err)
	if err != nil {
		return err
	}

	if err := apply(tx, stored); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("appstorage: commit: %w", err)
	}
	return nil
}
