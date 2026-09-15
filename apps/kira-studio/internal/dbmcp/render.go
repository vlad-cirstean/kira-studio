package dbmcp

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// textResult wraps text as a successful *mcp.CallToolResult — repomap/tools.go's own shape (Out is
// any everywhere here too, so the SDK publishes no output schema and every answer is one
// TextContent).
func textResult(text string) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
}

// errResult wraps text as a caller-correctable failure — §5.3's split, the SDK's own contract:
// IsError for a condition the caller can fix, a bare Go error only for a genuine internal fault.
func errResult(text string) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
		IsError: true,
	}, nil, nil
}

// jsonResult marshals v as compact JSON and wraps it as a successful result (§5.1): the exact
// structs the frontend receives, no prose wrapper and no human formatting — the client is a model
// composing SQL against identifiers that can contain spaces, quotes and non-ASCII, and JSON
// round-trips them exactly.
func jsonResult(v any) (*mcp.CallToolResult, any, error) {
	encoded, err := json.Marshal(v)
	if err != nil {
		return nil, nil, fmt.Errorf("dbmcp: encode result: %w", err)
	}
	return textResult(string(encoded))
}

// toolError classifies err per §5.3's split. A caller-correctable condition — an *adapters.Error
// carrying a real E_* code (adapters.CodeOf), or an *ipcerr.Error (e.g. ipcerr.Disconnected) —
// becomes an IsError result with the adapter's own message verbatim, prefixed with its code so a
// client can branch on it without parsing prose. Anything else is a genuine internal fault,
// returned as a Go error so the SDK reports it as such rather than a tool-level failure.
func toolError(err error) (*mcp.CallToolResult, any, error) {
	if code, ok := adapters.CodeOf(err); ok {
		return errResult(fmt.Sprintf("%s: %s", code, err.Error()))
	}
	var ipcErr *ipcerr.Error
	if errors.As(err, &ipcErr) {
		return errResult(fmt.Sprintf("%s: %s", ipcErr.Code, ipcErr.Message))
	}
	return nil, nil, err
}

// --- list_connections' own response shape (§4.1) ---

// connectionCapabilities is list_connections' own "capabilities" object — present only when the
// connection is currently connected (capsOf's own ok=false otherwise omits the whole field).
type connectionCapabilities struct {
	Query         bool `json:"query"`
	Describe      bool `json:"describe"`
	SchemaColumns bool `json:"schemaColumns"`
}

// connectionPermissions is list_connections' own "permissions" object (M2 §6.1) — always present,
// so a client that knows a write will be refused can say so instead of composing one.
type connectionPermissions struct {
	Read  string `json:"read"`
	Write string `json:"write"`
	DDL   string `json:"ddl"`
}

// connectionView is list_connections' own per-connection element.
type connectionView struct {
	ID            string                  `json:"id"`
	Name          string                  `json:"name"`
	Kind          string                  `json:"kind"`
	ReadOnly      bool                    `json:"readOnly"`
	Status        string                  `json:"status"`
	ServerVersion *string                 `json:"serverVersion,omitempty"`
	Capabilities  *connectionCapabilities `json:"capabilities,omitempty"`
	// Description is M2's free-text "what this DB is for", passed verbatim — omitted when unset.
	Description string `json:"description,omitempty"`
	// Permissions is M2's per-operation MCP mode, always present.
	Permissions connectionPermissions `json:"permissions"`
}

// --- run_query's own projection (§5.2) — a projection because rows cross to the frontend as
// FlatBuffers (page.Chunk), so no existing JSON row shape exists to reuse. One entry point
// (renderPage) so M5's anonymization filter has exactly one place to insert itself, between
// Query.Execute and this projection (§9's own seam). ---

type tabularColumn struct {
	Name      string `json:"name"`
	DataType  string `json:"dataType"`
	TypeClass string `json:"typeClass"`
}

type tabularResult struct {
	Kind           string          `json:"kind"`
	Columns        []tabularColumn `json:"columns"`
	Rows           [][]*string     `json:"rows"`
	RowCount       int             `json:"rowCount"`
	Returned       int             `json:"returned"`
	TruncatedCells int             `json:"truncatedCells"`
	Truncated      bool            `json:"truncated,omitempty"`
}

type documentEntry struct {
	ID   *string `json:"id"`
	Body *string `json:"body"`
}

type documentResult struct {
	Kind      string          `json:"kind"`
	Documents []documentEntry `json:"documents"`
	RowCount  int             `json:"rowCount"`
	Returned  int             `json:"returned"`
	Truncated bool            `json:"truncated,omitempty"`
}

type keyValueEntry struct {
	Field *string `json:"field"`
	Value *string `json:"value"`
}

type keyValueResult struct {
	Kind        string          `json:"kind"`
	RedisType   string          `json:"redisType"`
	TTLMs       *int64          `json:"ttlMs,omitempty"`
	MemoryBytes *int64          `json:"memoryBytes,omitempty"`
	Entries     []keyValueEntry `json:"entries"`
	RowCount    int             `json:"rowCount"`
	Returned    int             `json:"returned"`
	Truncated   bool            `json:"truncated,omitempty"`
}

type streamMessage struct {
	Key       *string `json:"key"`
	Timestamp *string `json:"timestamp"`
	Headers   *string `json:"headers"`
	Attrs     *string `json:"attrs"`
	Body      *string `json:"body"`
}

type streamResult struct {
	Kind      string          `json:"kind"`
	Messages  []streamMessage `json:"messages"`
	RowCount  int             `json:"rowCount"`
	Returned  int             `json:"returned"`
	Truncated bool            `json:"truncated,omitempty"`
}

// cellAt returns row's own text from chunk, or nil for SQL NULL — §5.2's own flagged hazard: a
// NULL row and an empty string both have Offsets[i] == Offsets[i+1], and only the Nulls bitset
// (page.IsNull) tells them apart. Getting this backwards renders NULL as "" — valid JSON a model
// would reason over incorrectly, with nothing failing anywhere.
func cellAt(chunk page.Chunk, row int) *string {
	if page.IsNull(chunk, row) {
		return nil
	}
	text := page.CellText(chunk, row)
	return &text
}

// renderPage projects one page.Page into its own JSON-ready envelope, capped at maxRows.
func renderPage(p page.Page, maxRows int) (any, error) {
	switch pg := p.(type) {
	case page.TabularPage:
		return renderTabularPage(pg, maxRows), nil
	case page.DocumentPage:
		return renderDocumentPage(pg, maxRows), nil
	case page.KeyValuePage:
		return renderKeyValuePage(pg, maxRows), nil
	case page.StreamPage:
		return renderStreamPage(pg, maxRows), nil
	default:
		// §5.2: "implement it rather than panicking on the fourth arm of a type switch" — reachable
		// only if a future adapter kind gains Caps().SQL with a page kind this projection has not
		// been taught yet. A clear internal error beats a silent wrong render.
		return nil, fmt.Errorf("dbmcp: render: unhandled page kind %T", p)
	}
}

func cappedReturned(rowCount, maxRows int) int {
	if rowCount > maxRows {
		return maxRows
	}
	return rowCount
}

func renderTabularPage(pg page.TabularPage, maxRows int) tabularResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	columns := make([]tabularColumn, len(pg.Columns))
	for i, c := range pg.Columns {
		columns[i] = tabularColumn{Name: c.Name, DataType: c.DataType, TypeClass: string(c.TypeClass)}
	}
	rows := make([][]*string, returned)
	for r := 0; r < returned; r++ {
		row := make([]*string, len(pg.Chunks))
		for c, chunk := range pg.Chunks {
			row[c] = cellAt(chunk, r)
		}
		rows[r] = row
	}
	return tabularResult{
		Kind: "tabular", Columns: columns, Rows: rows,
		RowCount: pg.RowCount, Returned: returned, TruncatedCells: pg.TruncatedCells,
		Truncated: returned < pg.RowCount,
	}
}

func renderDocumentPage(pg page.DocumentPage, maxRows int) documentResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	docs := make([]documentEntry, returned)
	for r := 0; r < returned; r++ {
		docs[r] = documentEntry{ID: cellAt(pg.IDs, r), Body: cellAt(pg.Bodies, r)}
	}
	return documentResult{Kind: "document", Documents: docs, RowCount: pg.RowCount, Returned: returned, Truncated: returned < pg.RowCount}
}

func renderKeyValuePage(pg page.KeyValuePage, maxRows int) keyValueResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	entries := make([]keyValueEntry, returned)
	for r := 0; r < returned; r++ {
		entries[r] = keyValueEntry{Field: cellAt(pg.Fields, r), Value: cellAt(pg.Values, r)}
	}
	return keyValueResult{
		Kind: "keyvalue", RedisType: pg.RedisType, TTLMs: pg.TTLMs, MemoryBytes: pg.MemoryBytes,
		Entries: entries, RowCount: pg.RowCount, Returned: returned, Truncated: returned < pg.RowCount,
	}
}

func renderStreamPage(pg page.StreamPage, maxRows int) streamResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	messages := make([]streamMessage, returned)
	for r := 0; r < returned; r++ {
		messages[r] = streamMessage{
			Key: cellAt(pg.Keys, r), Timestamp: cellAt(pg.Timestamps, r),
			Headers: cellAt(pg.Headers, r), Attrs: cellAt(pg.Attrs, r), Body: cellAt(pg.Bodies, r),
		}
	}
	return streamResult{Kind: "stream", Messages: messages, RowCount: pg.RowCount, Returned: returned, Truncated: returned < pg.RowCount}
}
