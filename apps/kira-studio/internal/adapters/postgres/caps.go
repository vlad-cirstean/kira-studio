package postgres

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// caps is caps.ts's postgresCaps, literally (§4.2).
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
