package memory

import "strings"

const (
	// Origin: who decided a fact. Grade order: user > external > agent.
	OriginUser     = "user"
	OriginAgent    = "agent"
	OriginExternal = "external"

	ScopeCompany  = "company"
	ScopeProject  = "project"
	ScopePersonal = "personal"

	// Group kinds. session, request and document are set by the server; the rest by the caller.
	GroupSession  = "session"
	GroupRequest  = "request"
	GroupTask     = "task"
	GroupDocument = "document"
	GroupThread   = "thread"

	SourceMCP    = "mcp"
	SourceUI     = "ui"
	SourceImport = "import"

	// Kind: a fact is a durable claim; a rule is a standing imperative with a reason.
	KindFact = "fact"
	KindRule = "rule"

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

// GradeOf ranks an origin: user 3, external 2, agent 1. Unknown origins rank 0.
func GradeOf(origin string) int {
	switch origin {
	case OriginUser:
		return 3
	case OriginExternal:
		return 2
	case OriginAgent:
		return 1
	}
	return 0
}

// Memory is one immutable version of a fact. Superseded versions stay queryable, flagged Historical.
// LineageID is the fact id, shared by every version; ID is the version id "<fact id>.<version>".
type Memory struct {
	ID           string   `json:"id"`
	LineageID    string   `json:"lineageId"`
	Version      int      `json:"version"`
	Fact         string   `json:"fact"`
	Kind         string   `json:"kind"`
	Reason       string   `json:"reason"`
	Keywords     []string `json:"keywords"`
	Origin       string   `json:"origin"`
	SourceTag    *string  `json:"sourceTag"`
	Scope        string   `json:"scope"`
	Project      *string  `json:"project"`
	SessionID    *string  `json:"sessionId"`
	Status       string   `json:"status"`
	Historical   bool     `json:"historical"`
	SupersedesID *string  `json:"supersedesId"`
	SupersededBy *string  `json:"supersededById"`
	CreatedAt    string   `json:"createdAt"`
	SupersededAt *string  `json:"supersededAt"`
	Versions     int      `json:"versions"`
	// Match is how a search found this memory: keyword, semantic or both. Empty outside search.
	Match string `json:"match,omitempty"`
	// Score explains the rank of a search result. Nil outside search.
	Score *Score `json:"score,omitempty"`
	// ContextCount is the other current facts sharing a non-session group; memory_context lists them.
	ContextCount int `json:"contextCount,omitempty"`

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
	Origin      string  `json:"origin"`
	SourceTag   *string `json:"sourceTag"`
	SessionID   *string `json:"sessionId"`
	Rationale   string  `json:"rationale"`
	CreatedAt   string  `json:"createdAt"`
}

// History is every version of one lineage, oldest first, with its audit events.
type History struct {
	Memories []Memory `json:"memories"`
	Events   []Event  `json:"events"`
}

// GroupRef names a group a fact joins. Kind, Key and Title come from the caller or the server.
type GroupRef struct {
	Kind  string `json:"kind"`
	Key   string `json:"key"`
	Title string `json:"title,omitempty"`
	// ID, set by the server only, names an existing group by its kg_ id (a doc's header group): the
	// group is found by id first and created with this id when absent.
	ID string `json:"-"`
}

// GroupContext is one group of a fact with its other current facts, newest first. Total counts every
// other fact in the group; Facts holds at most the requested limit.
type GroupContext struct {
	ID    string   `json:"id"`
	Kind  string   `json:"kind"`
	Key   string   `json:"key"`
	Title string   `json:"title"`
	Total int      `json:"total"`
	Facts []Memory `json:"facts"`
}

// Context is a fact's immediate context: the other facts stored with it, per group.
type Context struct {
	Memory Memory         `json:"memory"`
	Groups []GroupContext `json:"groups"`
}

func joinKeywords(k []string) string { return strings.Join(k, "\n") }

func splitKeywords(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, "\n")
}
