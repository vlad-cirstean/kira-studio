package repos

// rowScanner is Kira Studio's own repos-package helper, extracted here since this trimmed
// package's own files need it: Kira Studio keeps rowScanner inline in connections.go/
// collections.go — files this app has no equivalent of (no connections/collections tables), so it
// moves here instead of staying buried in a file that would otherwise never exist in this
// package. leaf/leafValid/alwaysValid moved to appsettings.Leaf/LeafValid/AlwaysValid (P103 Part
// 4, P107 T1-6); requireOneRow moved to sqlitex.RequireOneRow (P107 T1-7).

// rowScanner is *sql.Row and *sql.Rows' shared Scan surface — the same shape Kira Studio's own
// connections.go declares it, so a single scan function works against either a QueryRow result or
// a Query row-by-row loop.
type rowScanner interface {
	Scan(dest ...any) error
}
