package memory

import "strings"

const (
	AuthorUser  = "user"
	AuthorAgent = "agent"

	SourceMCP    = "mcp"
	SourceUI     = "ui"
	SourceImport = "import"

	StatusCurrent    = "current"
	StatusSuperseded = "superseded"

	ActionAdd    = "add"
	ActionUpdate = "update"
	ActionNoop   = "noop"
	ActionFailed = "failed"

	MaxFactLen   = 1000
	MaxReasonLen = 2000
	MaxKeywords  = 10
)

// Memory is one immutable version of a fact. Superseded versions stay queryable, flagged Historical.
type Memory struct {
	ID           string   `json:"id"`
	LineageID    string   `json:"lineageId"`
	Version      int      `json:"version"`
	Fact         string   `json:"fact"`
	Reason       string   `json:"reason"`
	Keywords     []string `json:"keywords"`
	Author       string   `json:"author"`
	Status       string   `json:"status"`
	Historical   bool     `json:"historical"`
	SupersedesID *string  `json:"supersedesId"`
	SupersededBy *string  `json:"supersededById"`
	CreatedAt    string   `json:"createdAt"`
	SupersededAt *string  `json:"supersededAt"`
	Versions     int      `json:"versions"`
	// Match is how a search found this memory: keyword, semantic or both. Empty outside search.
	Match string `json:"match,omitempty"`

	seq int64
}

// Event is one audit row: what a store decided for a fact, and why.
type Event struct {
	Seq       int64  `json:"seq"`
	RequestID string `json:"requestId"`
	Source    string `json:"source"`
	// SourceRef is the import file id for source "import"; SourceLabel is that file's relative path.
	SourceRef   *string `json:"sourceRef"`
	SourceLabel string  `json:"sourceLabel,omitempty"`
	Action      string  `json:"action"`
	LineageID   string  `json:"lineageId"`
	MemoryID    string  `json:"memoryId"`
	PreviousID  *string `json:"previousId"`
	Author      string  `json:"author"`
	Rationale   string  `json:"rationale"`
	CreatedAt   string  `json:"createdAt"`
}

// History is every version of one lineage, oldest first, with its audit events.
type History struct {
	Memories []Memory `json:"memories"`
	Events   []Event  `json:"events"`
}

func joinKeywords(k []string) string { return strings.Join(k, "\n") }

func splitKeywords(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, "\n")
}
