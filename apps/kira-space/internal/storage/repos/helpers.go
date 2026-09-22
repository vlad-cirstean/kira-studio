package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// leaf, leafValid, rowScanner and requireOneRow are Kira Studio's own repos-package helpers,
// extracted here into one file since every one of this trimmed package's own files needs at least
// one of them: Kira Studio keeps leaf/leafValid inline in its own settings.go and
// rowScanner/requireOneRow inline in connections.go/collections.go — files this app has no
// equivalent of (no connections/collections tables), so their helpers move here instead of staying
// buried in a file that would otherwise never exist in this package. alwaysValid moved to
// appsettings.AlwaysValid (P103 Part 4).

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

// leaf overwrites *dst with the stored value for key if present, leaving the caller's default in
// place otherwise. An unparseable stored value is a hand-edited or stale-shape row; it is left at
// its default rather than propagated, the same "fail closed to a known-good value" discipline the
// TS build's zod parse enforces.
func leaf[T any](stored map[string]json.RawMessage, key string, dst *T) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	*dst = v
}

// leafValid is leaf plus semantic validation: a stored value that parses but fails valid falls
// back to the default too.
func leafValid[T any](stored map[string]json.RawMessage, key string, dst *T, valid func(T) bool) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	if !valid(v) {
		return
	}
	*dst = v
}
