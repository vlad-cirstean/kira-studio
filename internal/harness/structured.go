package harness

import (
	"context"
	"encoding/json"
	"time"
)

// Structured runs one-shot calls whose answer is a JSON document matching a schema.
type Structured interface {
	RunStructured(ctx context.Context, model string, c StructuredCall) (StructuredResult, error)
	// Fail is the provider's user-facing error of kind, one of the Err* kinds.
	Fail(kind error) error
}

// StructuredCall is one isolated request with a JSON-schema answer. Only System and Input reach
// the model.
type StructuredCall struct {
	System string
	Input  string // JSON document on stdin
	Schema json.RawMessage
	// MCPServers are the only MCP servers the call may use; MCPTools the only tools it may call.
	MCPServers []MCPServer
	MCPTools   []MCPTool
	// ReadFiles lets the call read and search Files, seeded into its own empty working dir.
	ReadFiles bool
	Files     map[string][]byte
	MaxTurns  int           // 0 leaves the provider default
	Timeout   time.Duration // 0 means the provider default
	Budget    string        // USD cap, "" means the provider default
}

// StructuredResult is a finished call: the answer plus what the agent reported spending.
type StructuredResult struct {
	Output json.RawMessage
	Usage
}

// Usage is what a call reported spending; valid alongside an error.
type Usage struct {
	CostUSD float64
	Turns   int
}
