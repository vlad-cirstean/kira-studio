package importer

import "context"

// Agent is the Claude steps the runner drives. The real one shells out to Claude Code
// (ClaudeAgent); runner tests script a fake.
type Agent interface {
	// Available fails with a user-facing message when Claude Code cannot run.
	Available() error
	Extract(ctx context.Context, in ExtractInput) (ExtractOutput, error)
	Verify(ctx context.Context, in VerifyInput) (VerifyOutput, error)
	Finalize(ctx context.Context, in FinalizeInput) (FinalizeOutput, error)
}

type ExtractInput struct {
	Path, Title string
	Index       int // zero-based
	Count       int
	HeadingPath string
	Context     string
	Text        string
}

// Fact is one atomic claim extracted from a chunk. Unresolved names what the text leaves open
// ("which service 'it' is"); empty when the fact stands alone.
type Fact struct {
	Fact       string `json:"fact"`
	Evidence   string `json:"evidence"`
	Section    string `json:"section"`
	Unresolved string `json:"unresolved"`
}

// ExtractOutput.CostUSD is valid even alongside an error.
type ExtractOutput struct {
	Facts   []Fact
	CostUSD float64
}

type FinalizeInput struct {
	FileID, Path, Title string
	ChunkCount          int
	Prov                Provenance
	Facts               []FinalFact
}

// FinalFact is a Fact tagged with the chunk it came from, in document order. Section and Reason are
// set by code, never the model: the chunk's heading path and the source locator built from it.
type FinalFact struct {
	ID     string `json:"id"` // "<chunk>.<n>", one-based chunk
	Chunk  int    `json:"chunk"`
	Reason string `json:"reason"`
	Fact
}

type UnresolvedFact struct {
	Fact      string   `json:"fact"`
	Questions []string `json:"questions"`
}

type DroppedFact struct {
	Fact string `json:"fact"`
	Why  string `json:"why"`
}

// FinalizeOutput lists only what the agent alone knows; stored counts come from memory_events.
type FinalizeOutput struct {
	Unresolved []UnresolvedFact
	Dropped    []DroppedFact
	CostUSD    float64
	// Prov, GroupID and Orphaned are a memdoc's own result: the doc header's provenance and group,
	// and the stored facts it no longer lists.
	Prov     *Provenance
	GroupID  string
	Orphaned int
}
