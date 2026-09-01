package sqlite

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// caps is caps.ts's sqliteCaps, with one field changed from the TypeScript original (B8, P58 D8):
// Cancel is true here, not false. node:sqlite exposed no sqlite3_interrupt and its whole API was
// synchronous, so a running statement blocked the event loop and an abort could never even be
// delivered while one ran (F10) — the app's first honest `false`. modernc.org/sqlite has a real
// sqlite3_interrupt, reached by cancelling the adapter-owned per-op driver context (adapter.go's
// runOnConn), so this is the Go port's first honest `true` instead. ExactCount is unchanged:
// count(*) over a million rows measured at 9ms in P35's own sandbox (F11) — cheaper than any other
// engine in the app. FileTransfer stays false: SQLite being itself a file does not make its items
// (rows) files.
var caps = adapters.Caps{
	Tabular:         true,
	Documents:       false,
	KeyValue:        false,
	Stream:          false,
	KeyBrowser:      false,
	DefaultPageKind: page.PageKindTabular,
	SQL:             true,
	Definition:      true,
	Describe:        true,
	Projection:      true,
	ServerFilter:    true,
	ExactCount:      true,
	Pagination:      adapters.PaginationKeyset,
	ForeignKeys:     true,
	CanInsert:       true,
	CanUpdate:       true,
	CanDelete:       true,
	Writable:        true,
	Transactions:    true,
	Cancel:          true,
	FileTransfer:    false,
}
