package dbmcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"

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

// maskedToolError is toolError's own sibling for a query executed against a connection with
// active mask rules (finding #4, M6): a Postgres/MySQL driver error routinely embeds the value
// that failed — a type-cast error names the literal it couldn't parse, for instance — so passing
// the adapter's message straight through leaked the real, unmasked value one row at a time (e.g.
// SELECT email::int FROM customers LIMIT 1 OFFSET n). The code (whatever adapters.CodeOf/ipcerr
// already parsed out) is kept, since it carries no row data; the message is replaced with a fixed,
// value-free description. An internal fault (neither an *adapters.Error nor an *ipcerr.Error)
// still returns as a bare Go error, same as toolError — there is no adapter message to withhold.
func maskedToolError(err error) (*mcp.CallToolResult, any, error) {
	if code, ok := adapters.CodeOf(err); ok {
		return errResult(fmt.Sprintf("%s: query failed (message withheld — this connection has active PII masking rules)", code))
	}
	var ipcErr *ipcerr.Error
	if errors.As(err, &ipcErr) {
		return errResult(fmt.Sprintf("%s: query failed (message withheld — this connection has active PII masking rules)", ipcErr.Code))
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

// statementIdentifierWords splits statement into its word-shaped tokens (letters/digits/
// underscore runs), lowercased — the same notion of "word" classify.go's own
// sqlWordBoundaryContainsAny uses, applied here so a masked column name is matched by whole
// identifier, never as a substring of an unrelated longer one (e.g. "email" must not match inside
// "emails_sent").
func statementIdentifierWords(statement string) map[string]bool {
	words := map[string]bool{}
	for _, f := range strings.FieldsFunc(statement, func(r rune) bool {
		return !(r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r))
	}) {
		words[strings.ToLower(f)] = true
	}
	return words
}

// maskedColumnRenamedOrHidden reports the first masked column name (M5 §4.2's Set.Rules, already
// lowercased) that statement's own text mentions by word but that the actual result set (columns)
// carries no exact-name column for — i.e. an alias (`SELECT email AS e`), a wrapping expression
// (`SELECT lower(email)`), or a subquery plausibly renamed or transformed it. Without this check,
// columnRules's exact-name-only match sees nothing to mask on that result column and the real
// value returns unmasked (finding #3, M6) — under-masking, the opposite of this design's stated
// over-mask-on-ambiguity intent (mask.Set.RuleFor's own doc comment).
//
// An exact-name column being present is not by itself proof every mention of that column was
// rendered under a name columnRules can match (finding #1, M7): `SELECT email, email AS leak FROM
// customers` carries "email" under its own name *and* a second, differently-named projection of
// the same column — the first occurrence must not excuse the second. maskColumnRenamedViaAlias
// catches that second case once the masked name is confirmed present.
//
// Residual, undetectable by a text scanner over the outer statement alone: a pre-existing view
// that itself renames a masked column (`CREATE VIEW v AS SELECT email AS e ...; SELECT e FROM v`)
// mentions the masked column's real name nowhere in the statement this function sees — the view
// definition isn't visible here. Documented as a known open item rather than chased further.
func maskedColumnRenamedOrHidden(statement string, mk *maskset, columns []page.ColumnDescriptor) (string, bool) {
	if mk == nil || mk.Empty() || statement == "" {
		return "", false
	}
	present := make(map[string]bool, len(columns))
	presentNames := make([]string, 0, len(columns))
	for _, c := range columns {
		lower := strings.ToLower(c.Name)
		present[lower] = true
		presentNames = append(presentNames, lower)
	}
	words := statementIdentifierWords(statement)
	// Deterministic across calls despite map iteration order, for a stable error message.
	names := make([]string, 0, len(mk.Rules))
	for name := range mk.Rules {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !present[name] {
			if words[name] {
				return name, true
			}
			continue
		}
		if maskColumnRenamedViaAlias(statement, name, presentNames) {
			return name, true
		}
	}
	return "", false
}

// maskColumnRenamedViaAlias reports whether statement contains explicit alias evidence — the
// masked column name, followed (with no intervening top-level comma, i.e. still the same
// projection item) by an "AS <alias>" — where alias is itself one of the columns actually present
// in the result set under a name other than the masked column's own. This is what
// maskedColumnRenamedOrHidden's exact-name presence check alone cannot see: `SELECT email, email
// AS leak FROM customers` satisfies "email present under its own name" while also carrying a
// second, unmasked projection of the same value under "leak".
//
// Restricted to columns actually present in the output (never "any word after AS anywhere") so
// this doesn't false-positive on an unrelated alias that merely happens to share a statement with
// a masked column, e.g. `SELECT id, other_col AS leak, email FROM t` — "leak" there derives from
// other_col, not email, and the required "email ... AS leak" adjacency (no comma crossed) is absent.
func maskColumnRenamedViaAlias(statement, name string, presentNames []string) bool {
	var aliases []string
	for _, n := range presentNames {
		if n != name {
			aliases = append(aliases, regexp.QuoteMeta(n))
		}
	}
	if len(aliases) == 0 {
		return false
	}
	pattern := `(?i)\b` + regexp.QuoteMeta(name) + `\b[^,]*\bas\b\s*\b(?:` + strings.Join(aliases, "|") + `)\b`
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false
	}
	return re.MatchString(statement)
}

// newMaskRenameRefusedError is §4.4's refusal, reused for the aliasing/expression case (finding
// #3): the statement mentions a masked column that the result set does not carry under its own
// name, so refuse rather than silently return it unmasked.
func newMaskRenameRefusedError(column string) error {
	return &maskingRefusedError{msg: fmt.Sprintf(
		"this query renames or transforms a masked column (%q) — select it by its own name to see the masked value; the maskless raw form isn't permitted over this connection",
		column,
	)}
}

// newMaskColumnlessKeyValueRefusedError is renderKeyValuePage's own refusal (finding #3, M7): a
// keyvalue page whose Field values carry no genuine per-entry identifier (page.KeyValuePage's own
// FieldsAreColumns=false — a Redis list/set's synthetic display index, a stream entry id, a
// generic console reply with no per-command shape) can never be checked against a mask rule at
// all: RuleFor/ApplyColumn would just never match, passing the real value straight through while
// list_connections still reports the connection as protected. Same fail-closed posture as the
// document/stream page refusal above: refuse outright rather than silently skip masking.
func newMaskColumnlessKeyValueRefusedError() error {
	return &maskingRefusedError{msg: "this connection has PII masking rules, which cannot be applied to this result — it carries no real per-entry field name a mask rule's column could match (e.g. a list/set display index, a stream entry id, or a command reply with no per-command field shape); re-read it through a command whose reply names real fields (e.g. HGET/HMGET/HGETALL on a hash), or remove the rules in the connection's Privacy tab"}
}

// renderPage projects one page.Page into its own JSON-ready envelope, capped at maxRows. plan is
// run_query's own auto-force-explain result (nil when auto-force-explain is off, the statement
// was not explainable, or the plan-only EXPLAIN failed) — M5's own seam (M1 §9), now taking a plan
// summary alongside the page (M3 §5.3). mk is the connection's resolved masking state (M5 §4.2);
// nil means no rules on this connection, and the projection behaves exactly as it does today.
// statement is the original SQL text (finding #3, M6) — used only to catch a masked column
// reaching the result set renamed or transformed past columnRules's exact-name match; empty for a
// page kind rendered on some other path that has none to offer.
func renderPage(p page.Page, maxRows int, plan *planSummary, mk *maskset, statement string) (any, error) {
	switch pg := p.(type) {
	case page.TabularPage:
		if name, hidden := maskedColumnRenamedOrHidden(statement, mk, pg.Columns); hidden {
			return nil, newMaskRenameRefusedError(name)
		}
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
		if mk != nil && !mk.Empty() && !pg.FieldsAreColumns {
			return nil, newMaskColumnlessKeyValueRefusedError()
		}
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

// withAdditionalStatementResultsNote marks rendered (a run_query result, always one of the
// concrete *Result structs above) with the count of further statement results the adapter
// produced but this call did not render (finding #12, M6) — e.g. `args.SQL` held more than one
// `;`-separated statement, and only the first one's page is ever projected. Without this, extra
// statements ran (a write among them, possibly) with no sign in the response that anything but
// the shown result happened. Round-trips through JSON rather than adding the field to every
// concrete result type, so run_query's ordinary (single-page) shape is untouched.
func withAdditionalStatementResultsNote(rendered any, extraPages int) any {
	encoded, err := json.Marshal(rendered)
	if err != nil {
		return rendered
	}
	var m map[string]any
	if err := json.Unmarshal(encoded, &m); err != nil {
		return rendered
	}
	m["additionalStatementResults"] = extraPages
	m["note"] = fmt.Sprintf(
		"this call ran %d additional statement(s) beyond the one shown here; only the first statement's result is returned",
		extraPages,
	)
	return m
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
