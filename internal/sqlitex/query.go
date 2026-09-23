package sqlitex

import (
	"database/sql"
	"fmt"
)

// QueryAll drains rows (or reports queryErr) via scan into a []T, closing rows when done — the
// query/loop/rows.Err/close skeleton nearly every repo's own List() (and List-shaped read)
// repeated identically across both apps (P107 I2-2). scan's own keep result lets a caller drop a
// row without erroring and without appending it (TabsRepo.List's own drop-and-log for a legacy
// row that fails its envelope check); every other caller's own scan always returns keep true.
func QueryAll[T any](rows *sql.Rows, queryErr error, scan func(*sql.Rows) (v T, keep bool, err error)) ([]T, error) {
	if queryErr != nil {
		return nil, fmt.Errorf("sqlitex: query: %w", queryErr)
	}
	defer rows.Close()

	out := []T{}
	for rows.Next() {
		v, keep, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("sqlitex: scan: %w", err)
		}
		if keep {
			out = append(out, v)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlitex: rows: %w", err)
	}
	return out, nil
}
