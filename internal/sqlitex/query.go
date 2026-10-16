package sqlitex

import (
	"database/sql"
	"errors"
	"fmt"
)

// Queryer is satisfied by *sql.DB and *sql.Tx — QueryOne/NextSortOrder run as a standalone call or
// inside a caller's own transaction, whichever that call site already needs.
type Queryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

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

// QueryOne runs query against q and hands the one resulting row to scan, mapping sql.ErrNoRows to
// (nil, nil) — the by-id Get(id) shape repeated across both apps' repos (P113 G12): "no such row"
// and, for a scan that does its own extra validation on top of Scan (connections.go's
// scanConnectionRow), "this row exists but isn't usable" both already returned (nil, nil) before
// this helper existed, so scan returning (nil, nil) with no error passes straight through
// unchanged. Any other error is returned as-is — the caller wraps it in its own "repos/x: get %s"
// message, matching what each of these Get methods did by hand.
func QueryOne[T any](q Queryer, scan func(*sql.Row) (*T, error), query string, args ...any) (*T, error) {
	v, err := scan(q.QueryRow(query, args...))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return v, nil
}

// NextSortOrder is Create/Insert's shared "append to the end" query (P113 G12), unifying the three
// spellings repeated across both apps' repos (some `COALESCE(MAX(sort_order) + 1, 0)`, one a
// separate nullable-scan-then-+1-in-Go dance) — all equivalent: 0 for an empty (or empty-scope)
// table, one past the current max otherwise. where, when non-empty, is appended as "WHERE <where>"
// verbatim (a caller-built column/comparison clause, e.g. "collection_id = ? AND parent_id IS ?");
// args are that clause's own bind values, in order.
func NextSortOrder(q Queryer, table, where string, args ...any) (int, error) {
	query := `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ` + table
	if where != "" {
		query += ` WHERE ` + where
	}
	var order int
	if err := q.QueryRow(query, args...).Scan(&order); err != nil {
		return 0, fmt.Errorf("sqlitex: next sort order: %w", err)
	}
	return order, nil
}
