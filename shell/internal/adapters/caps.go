package adapters

import "github.com/kirathecat/kira-studio/shell/internal/page"

// PaginationStrategy mirrors shared/caps.ts's PaginationStrategy.
type PaginationStrategy string

const (
	PaginationKeyset       PaginationStrategy = "keyset"
	PaginationOffset       PaginationStrategy = "offset"
	PaginationCursor       PaginationStrategy = "cursor"
	PaginationToken        PaginationStrategy = "token"
	PaginationOffsetWindow PaginationStrategy = "offsetWindow"
	PaginationBatch        PaginationStrategy = "batch"
)

// Caps mirrors shared/caps.ts's Caps exactly — field order follows caps.ts's own declaration
// order (P58a A2) so the two files diff against each other. MaxPageSize is a pointer with
// omitempty: a plain int without omitempty would emit "maxPageSize": 0 for the ten adapters that
// have none, which capsSchema.parse (positive-int) rejects on the TypeScript side while the two
// coexist.
type Caps struct {
	Tabular         bool               `json:"tabular"`
	Documents       bool               `json:"documents"`
	KeyValue        bool               `json:"keyValue"`
	Stream          bool               `json:"stream"`
	KeyBrowser      bool               `json:"keyBrowser"`
	DefaultPageKind page.PageKind      `json:"defaultPageKind"`
	SQL             bool               `json:"sql"`
	Definition      bool               `json:"definition"`
	Describe        bool               `json:"describe"`
	Projection      bool               `json:"projection"`
	ServerFilter    bool               `json:"serverFilter"`
	ExactCount      bool               `json:"exactCount"`
	Pagination      PaginationStrategy `json:"pagination"`
	ForeignKeys     bool               `json:"foreignKeys"`
	CanInsert       bool               `json:"canInsert"`
	CanUpdate       bool               `json:"canUpdate"`
	CanDelete       bool               `json:"canDelete"`
	Writable        bool               `json:"writable"`
	Transactions    bool               `json:"transactions"`
	Cancel          bool               `json:"cancel"`
	FileTransfer    bool               `json:"fileTransfer"`
	MaxPageSize     *int               `json:"maxPageSize,omitempty"`
}
