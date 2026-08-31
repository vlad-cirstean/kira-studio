package mariadb

import (
	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
)

// caps is caps.ts's mariadbCaps, literally — identical to Postgres's and to mysql's own (P34 D10:
// stated per engine rather than shared, so a future divergence has somewhere honest to be said).
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
