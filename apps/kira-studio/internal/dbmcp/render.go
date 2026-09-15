package dbmcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mask"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// maskset aliases mask.Set — dbmcp's own name for the resolved per-connection masking state at
// call sites (renderPage's own mk parameter), kept distinct from the type's home package for
// readability; MaskRules.MaskSetFor returns the exact same type.
type maskset = mask.Set

// maskingRefusedError is render's own "cannot mask a document/stream page" refusal (plan §4.4) — a
// distinct type so runQuery can tell it apart from a genuine internal render fault and surface it
// as a caller-correctable IsError result (§5.3's split) rather than a raw Go error.
type maskingRefusedError struct{ msg string }

func (e *maskingRefusedError) Error() string { return e.msg }

// newMaskingRefusedError builds §4.4's own refusal text for pageKind ("document" or "stream"),
// bodyNoun naming what that page kind carries instead of columns ("a document body", "a stream
// message body").
func newMaskingRefusedError(pageKind, bodyNoun string) error {
	return &maskingRefusedError{msg: fmt.Sprintf(
		"this connection has PII masking rules, which cannot be applied to a %s result; masking rules address table columns, and %s has none — narrow the query to a projection, or remove the rules in the connection's Privacy tab",
		pageKind, bodyNoun,
	)}
}

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
	// MaskedColumns is M5 §4.5's own addition: "table.column: kind" per rule, sorted, capped at 50
	// with a trailing "+N more" entry — so a client that does not know a column is masked does not
	// misread a bucket string (e.g. "[1000-10000)") as a literal value. Omitted when the connection
	// has no rules at all.
	MaskedColumns []string `json:"maskedColumns,omitempty"`
}

// maskedColumnsMaxListed is §4.5's own cap — 50 entries, then a trailing "+N more" summary rather
// than an unbounded list for a connection with hundreds of masked columns.
const maskedColumnsMaxListed = 50

// maskedColumnsFor formats rules as list_connections' own "table.column: kind" strings, sorted,
// capped per maskedColumnsMaxListed.
func maskedColumnsFor(rules []model.MaskRule) []string {
	if len(rules) == 0 {
		return nil
	}
	entries := make([]string, len(rules))
	for i, r := range rules {
		entries[i] = fmt.Sprintf("%s.%s: %s", r.TableName, r.ColumnName, r.Kind)
	}
	sort.Strings(entries)
	if len(entries) <= maskedColumnsMaxListed {
		return entries
	}
	out := append([]string{}, entries[:maskedColumnsMaxListed]...)
	out = append(out, fmt.Sprintf("+%d more", len(entries)-maskedColumnsMaxListed))
	return out
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

// planEnvelope is embedded in each result struct so `plan` inlines into the same JSON object the
// client already reads — run_query's response shape is otherwise unchanged from M1/M2. Omitted
// entirely when no plan was produced (omitempty on a nil pointer), never a `"plan": null` a
// client might read as "planned, found nothing" (M3 §5.3).
type planEnvelope struct {
	Plan *planSummary `json:"plan,omitempty"`
}

type tabularResult struct {
	Kind           string          `json:"kind"`
	Columns        []tabularColumn `json:"columns"`
	Rows           [][]*string     `json:"rows"`
	RowCount       int             `json:"rowCount"`
	Returned       int             `json:"returned"`
	TruncatedCells int             `json:"truncatedCells"`
	Truncated      bool            `json:"truncated,omitempty"`
	planEnvelope
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
	planEnvelope
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
	planEnvelope
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
	planEnvelope
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

// renderPage projects one page.Page into its own JSON-ready envelope, capped at maxRows. plan is
// run_query's own auto-force-explain result (nil when auto-force-explain is off, the statement
// was not explainable, or the plan-only EXPLAIN failed) — M5's own seam (M1 §9), now taking a plan
// summary alongside the page (M3 §5.3). mk is the connection's resolved masking state (M5 §4.2);
// nil means no rules on this connection, and the projection behaves exactly as it does today.
func renderPage(p page.Page, maxRows int, plan *planSummary, mk *maskset) (any, error) {
	switch pg := p.(type) {
	case page.TabularPage:
		r := renderTabularPage(pg, maxRows, mk)
		r.Plan = plan
		return r, nil
	case page.DocumentPage:
		if mk != nil && !mk.Empty() {
			return nil, newMaskingRefusedError("document", "a document body")
		}
		r := renderDocumentPage(pg, maxRows)
		r.Plan = plan
		return r, nil
	case page.KeyValuePage:
		r := renderKeyValuePage(pg, maxRows, mk)
		r.Plan = plan
		return r, nil
	case page.StreamPage:
		if mk != nil && !mk.Empty() {
			return nil, newMaskingRefusedError("stream", "a stream message body")
		}
		r := renderStreamPage(pg, maxRows)
		r.Plan = plan
		return r, nil
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

// columnRules resolves columns against mk once — §4.2's own cost rule ("the lookup is per column,
// once per call, never per row"). A nil mk or one with no matching column yields a nil slice, so
// the row loop below pays one nil check per cell and nothing more.
func columnRules(columns []page.ColumnDescriptor, mk *maskset) []*mask.Rule {
	if mk == nil || mk.Empty() {
		return nil
	}
	rules := make([]*mask.Rule, len(columns))
	matched := false
	for i, c := range columns {
		if r, ok := mk.RuleFor(c.Name); ok {
			rr := r
			rules[i] = &rr
			matched = true
		}
	}
	if !matched {
		return nil
	}
	return rules
}

func renderTabularPage(pg page.TabularPage, maxRows int, mk *maskset) tabularResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	columns := make([]tabularColumn, len(pg.Columns))
	for i, c := range pg.Columns {
		columns[i] = tabularColumn{Name: c.Name, DataType: c.DataType, TypeClass: string(c.TypeClass)}
	}
	rules := columnRules(pg.Columns, mk)
	var masker *mask.Masker
	if rules != nil {
		masker = mk.Masker
		if masker == nil {
			masker = mask.New(nil)
		}
	}
	rows := make([][]*string, returned)
	for r := 0; r < returned; r++ {
		row := make([]*string, len(pg.Chunks))
		for c, chunk := range pg.Chunks {
			v := cellAt(chunk, r)
			if rules != nil && rules[c] != nil {
				v = masker.MaskNullable(*rules[c], v)
			}
			row[c] = v
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

// renderKeyValuePage also masks (§4.3): a Redis hash field or an S3 metadata key is column-shaped,
// so a rule whose column_name matches keyValueEntry.Field masks that entry's Value. Resolved per
// entry, not once per call like renderTabularPage's columns — a keyvalue page has no fixed column
// set (Field varies row to row), so there is no per-column list to precompute against.
func renderKeyValuePage(pg page.KeyValuePage, maxRows int, mk *maskset) keyValueResult {
	returned := cappedReturned(pg.RowCount, maxRows)
	entries := make([]keyValueEntry, returned)
	for r := 0; r < returned; r++ {
		field := cellAt(pg.Fields, r)
		value := cellAt(pg.Values, r)
		if mk != nil && !mk.Empty() && field != nil {
			if masked, matched := mk.ApplyColumn(*field, value); matched {
				value = masked
			}
		}
		entries[r] = keyValueEntry{Field: field, Value: value}
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
