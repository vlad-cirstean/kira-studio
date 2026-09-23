package repos

import (
	"database/sql"
	"fmt"
)

// rowScanner and requireOneRow are Kira Studio's own repos-package helpers, extracted here since
// this trimmed package's own files need them: Kira Studio keeps rowScanner/requireOneRow inline
// in connections.go/collections.go — files this app has no equivalent of (no
// connections/collections tables), so they move here instead of staying buried in a file that
// would otherwise never exist in this package. leaf/leafValid/alwaysValid moved to
// appsettings.Leaf/LeafValid/AlwaysValid (P103 Part 4, P107 T1-6).

// rowScanner is *sql.Row and *sql.Rows' shared Scan surface — the same shape Kira Studio's own
// connections.go declares it, so a single scan function works against either a QueryRow result or
// a Query row-by-row loop.
type rowScanner interface {
	Scan(dest ...any) error
}

// requireOneRow turns an UPDATE/DELETE's RowsAffected() == 0 into a "no such <target>" error —
// Kira Studio's own repos/collections.go's requireOneRow, genericized from a "repos/collections:"
// error prefix to "repos:" since this package has no per-file prefix convention of its own to
// match.
func requireOneRow(res sql.Result, target, id string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: rows affected: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("repos: no %s %s", target, id)
	}
	return nil
}
