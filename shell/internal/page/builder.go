package page

import (
	"encoding/json"
	"fmt"
	"time"
)

// TypeClass mirrors page.ts's TypeClass.
type TypeClass string

const (
	TypeClassNumber   TypeClass = "number"
	TypeClassText     TypeClass = "text"
	TypeClassBoolean  TypeClass = "boolean"
	TypeClassTemporal TypeClass = "temporal"
	TypeClassBinary   TypeClass = "binary"
	TypeClassJSON     TypeClass = "json"
	TypeClassOther    TypeClass = "other"
)

// ColumnDescriptor mirrors page.ts's ColumnDescriptor.
type ColumnDescriptor struct {
	Name         string    `json:"name"`
	DataType     string    `json:"dataType"`
	TypeClass    TypeClass `json:"typeClass"`
	Nullable     bool      `json:"nullable"`
	IsPrimaryKey bool      `json:"isPrimaryKey"`
	Generated    bool      `json:"generated"`
}

// PagePosition mirrors page.ts's PagePosition.
type PagePosition struct {
	Offset    *int    `json:"offset"`
	PageSize  int     `json:"pageSize"`
	HasMore   bool    `json:"hasMore"`
	NextToken *string `json:"nextToken"`
	PrevToken *string `json:"prevToken"`
	Strategy  string  `json:"strategy"` // "keyset" | "offset" | "cursor" | "offsetWindow" | "batch"
}

// UnpagedPosition is page.ts's unpagedPosition — a page that is the whole result.
func UnpagedPosition(rowCount int) PagePosition {
	offset := 0
	return PagePosition{Offset: &offset, PageSize: rowCount, HasMore: false, Strategy: "offset"}
}

// PageKind mirrors shared/caps.ts's PageKind (page.ts re-exports it for convenience; the Go
// package lives here instead, since adapters.Caps must import page anyway for the Page type, and
// page must not import adapters back).
type PageKind string

const (
	PageKindTabular  PageKind = "tabular"
	PageKindDocument PageKind = "document"
	PageKindKeyValue PageKind = "keyvalue"
	PageKindStream   PageKind = "stream"
)

// Page is any of TabularPage, DocumentPage, KeyValuePage, StreamPage — page.ts's Page union.
// Size, not ByteSize, because a field named ByteSize already exists on every concrete type and Go
// does not allow a method and a field to share a name; internal/enginecache is the one caller that
// needs the byte cost through the interface rather than through the concrete struct.
type Page interface {
	PageKind() PageKind
	Size() int
}

func nowEpochMs() int64 {
	return time.Now().UnixMilli()
}

// TabularPage mirrors page.ts's TabularPage.
type TabularPage struct {
	Columns        []ColumnDescriptor
	RowCount       int
	Chunks         []Chunk // index-aligned with Columns
	Position       PagePosition
	TruncatedCells int
	ByteSize       int // measured, not estimated — what L2 budgets against
	FetchedAt      int64
}

func (TabularPage) PageKind() PageKind { return PageKindTabular }
func (p TabularPage) Size() int        { return p.ByteSize }

func (p TabularPage) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Kind           string             `json:"kind"`
		Columns        []ColumnDescriptor `json:"columns"`
		RowCount       int                `json:"rowCount"`
		Chunks         []Chunk            `json:"chunks"`
		Position       PagePosition       `json:"position"`
		TruncatedCells int                `json:"truncatedCells"`
		ByteSize       int                `json:"byteSize"`
		FetchedAt      int64              `json:"fetchedAt"`
	}{"tabular", p.Columns, p.RowCount, p.Chunks, p.Position, p.TruncatedCells, p.ByteSize, p.FetchedAt})
}

// columnEnvelopeBytesFor mirrors page.ts's pageByteSize UTF-16-length estimate: JS .length counts
// UTF-16 code units, which equals len([]rune(s)) for the entire BMP and differs only for
// astral-plane identifiers — an accepted, documented approximation (P58a's own decision).
func columnEnvelopeBytesFor(col ColumnDescriptor) int {
	return (len([]rune(col.Name))+len([]rune(col.DataType)))*2 + columnEnvelopeBytes
}

// PageByteSize ports page.ts's pageByteSize formula exactly, including the UTF-16 estimate — the
// L2 budget is only as honest as this number, and changing it would silently change eviction
// behaviour relative to what tests/unit/engine-cache.spec.ts's Go successor was written against.
func PageByteSize(p TabularPage) int {
	total := 0
	for i, chunk := range p.Chunks {
		total += ChunkByteSize(chunk) + columnEnvelopeBytesFor(p.Columns[i])
	}
	return total
}

// TabularPageBuilder mirrors page.ts's TabularPageBuilder.
type TabularPageBuilder struct {
	columns   []ColumnDescriptor
	scratches []*columnScratch
	rowCount  int
	reversed  bool
	truncated int
}

// NewTabularPageBuilder mirrors page.ts's createTabularPageBuilder.
func NewTabularPageBuilder(columns []ColumnDescriptor) *TabularPageBuilder {
	scratches := make([]*columnScratch, len(columns))
	for i := range scratches {
		scratches[i] = newColumnScratch()
	}
	return &TabularPageBuilder{columns: columns, scratches: scratches}
}

// AppendRow appends one row: one *string (nil for NULL) per column, in Columns order.
func (b *TabularPageBuilder) AppendRow(values []*string) error {
	if len(values) != len(b.columns) {
		return fmt.Errorf("page: row has %d values, expected %d columns", len(values), len(b.columns))
	}
	row := b.rowCount
	for i := range b.columns {
		if b.scratches[i].appendValue(values[i], row, MaxCellBytes) {
			b.truncated++
		}
	}
	b.rowCount++
	return nil
}

// Reverse reverses the accumulated rows before Finish — used by a keyset 'before' page.
func (b *TabularPageBuilder) Reverse() { b.reversed = true }

// Finish builds the TabularPage.
func (b *TabularPageBuilder) Finish(position PagePosition) TabularPage {
	chunks := make([]Chunk, len(b.scratches))
	for i, s := range b.scratches {
		chunks[i] = s.finish(b.rowCount, b.reversed)
	}
	p := TabularPage{
		Columns:        b.columns,
		RowCount:       b.rowCount,
		Chunks:         chunks,
		Position:       position,
		TruncatedCells: b.truncated,
		FetchedAt:      nowEpochMs(),
	}
	p.ByteSize = PageByteSize(p)
	return p
}

// DocumentPage mirrors page.ts's DocumentPage.
type DocumentPage struct {
	Position  PagePosition
	IDs       Chunk
	Bodies    Chunk
	RowCount  int
	ByteSize  int
	FetchedAt int64
}

func (DocumentPage) PageKind() PageKind { return PageKindDocument }
func (p DocumentPage) Size() int        { return p.ByteSize }

func (p DocumentPage) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Kind      string       `json:"kind"`
		Position  PagePosition `json:"position"`
		IDs       Chunk        `json:"ids"`
		Bodies    Chunk        `json:"bodies"`
		RowCount  int          `json:"rowCount"`
		ByteSize  int          `json:"byteSize"`
		FetchedAt int64        `json:"fetchedAt"`
	}{"document", p.Position, p.IDs, p.Bodies, p.RowCount, p.ByteSize, p.FetchedAt})
}

// DocumentPageBuilder mirrors page.ts's DocumentPageBuilder.
type DocumentPageBuilder struct {
	maxBytes int
	ids      *columnScratch
	bodies   *columnScratch
	rowCount int
}

// NewDocumentPageBuilder mirrors page.ts's createDocumentPageBuilder.
func NewDocumentPageBuilder(singleRow bool) *DocumentPageBuilder {
	maxBytes := DocumentTruncateBytes
	if singleRow {
		maxBytes = DocumentTruncateBytesSingle
	}
	return &DocumentPageBuilder{maxBytes: maxBytes, ids: newColumnScratch(), bodies: newColumnScratch()}
}

// Push appends one document: id and body are each pre-serialized EJSON text.
func (b *DocumentPageBuilder) Push(id, body string) {
	row := b.rowCount
	b.ids.appendValue(&id, row, b.maxBytes)
	b.bodies.appendValue(&body, row, b.maxBytes)
	b.rowCount++
}

func (b *DocumentPageBuilder) Finish(position PagePosition) DocumentPage {
	ids := b.ids.finish(b.rowCount, false)
	bodies := b.bodies.finish(b.rowCount, false)
	return DocumentPage{
		Position: position, IDs: ids, Bodies: bodies, RowCount: b.rowCount,
		ByteSize: ChunkByteSize(ids) + ChunkByteSize(bodies), FetchedAt: nowEpochMs(),
	}
}

// KeyValuePage mirrors page.ts's KeyValuePage.
type KeyValuePage struct {
	Position    PagePosition
	RedisType   string // "string" | "hash" | "list" | "set" | "zset" | "stream" | "object"
	TTLMs       *int64
	MemoryBytes *int64
	Fields      Chunk
	Values      Chunk
	RowCount    int
	ByteSize    int
	FetchedAt   int64
}

func (KeyValuePage) PageKind() PageKind { return PageKindKeyValue }
func (p KeyValuePage) Size() int        { return p.ByteSize }

func (p KeyValuePage) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Kind        string       `json:"kind"`
		Position    PagePosition `json:"position"`
		RedisType   string       `json:"redisType"`
		TTLMs       *int64       `json:"ttlMs"`
		MemoryBytes *int64       `json:"memoryBytes"`
		Fields      Chunk        `json:"fields"`
		Values      Chunk        `json:"values"`
		RowCount    int          `json:"rowCount"`
		ByteSize    int          `json:"byteSize"`
		FetchedAt   int64        `json:"fetchedAt"`
	}{"keyvalue", p.Position, p.RedisType, p.TTLMs, p.MemoryBytes, p.Fields, p.Values, p.RowCount, p.ByteSize, p.FetchedAt})
}

// KeyValuePageBuilder mirrors page.ts's KeyValuePageBuilder.
type KeyValuePageBuilder struct {
	redisType     string
	ttlMs         *int64
	memoryBytes   *int64
	valueMaxBytes int
	fields        *columnScratch
	values        *columnScratch
	rowCount      int
}

// NewKeyValuePageBuilder mirrors page.ts's createKeyValuePageBuilder.
func NewKeyValuePageBuilder(redisType string, ttlMs, memoryBytes *int64, singleRow bool) *KeyValuePageBuilder {
	valueMaxBytes := MaxCellBytes
	if singleRow {
		valueMaxBytes = DocumentTruncateBytesSingle
	}
	return &KeyValuePageBuilder{
		redisType: redisType, ttlMs: ttlMs, memoryBytes: memoryBytes, valueMaxBytes: valueMaxBytes,
		fields: newColumnScratch(), values: newColumnScratch(),
	}
}

func (b *KeyValuePageBuilder) Push(field, value string) {
	row := b.rowCount
	b.fields.appendValue(&field, row, MaxCellBytes)
	b.values.appendValue(&value, row, b.valueMaxBytes)
	b.rowCount++
}

func (b *KeyValuePageBuilder) Finish(position PagePosition) KeyValuePage {
	fields := b.fields.finish(b.rowCount, false)
	values := b.values.finish(b.rowCount, false)
	return KeyValuePage{
		Position: position, RedisType: b.redisType, TTLMs: b.ttlMs, MemoryBytes: b.memoryBytes,
		Fields: fields, Values: values, RowCount: b.rowCount,
		ByteSize: ChunkByteSize(fields) + ChunkByteSize(values), FetchedAt: nowEpochMs(),
	}
}

// StreamPage mirrors page.ts's StreamPage.
type StreamPage struct {
	Position                 PagePosition
	Keys                     Chunk
	Headers                  Chunk
	Attrs                    Chunk
	Timestamps               Chunk
	Bodies                   Chunk
	RowCount                 int
	ByteSize                 int
	FetchedAt                int64
	VisibilityTimeoutSeconds *int
}

func (StreamPage) PageKind() PageKind { return PageKindStream }
func (p StreamPage) Size() int        { return p.ByteSize }

func (p StreamPage) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Kind                     string       `json:"kind"`
		Position                 PagePosition `json:"position"`
		Keys                     Chunk        `json:"keys"`
		Headers                  Chunk        `json:"headers"`
		Attrs                    Chunk        `json:"attrs"`
		Timestamps               Chunk        `json:"timestamps"`
		Bodies                   Chunk        `json:"bodies"`
		RowCount                 int          `json:"rowCount"`
		ByteSize                 int          `json:"byteSize"`
		FetchedAt                int64        `json:"fetchedAt"`
		VisibilityTimeoutSeconds *int         `json:"visibilityTimeoutSeconds"`
	}{"stream", p.Position, p.Keys, p.Headers, p.Attrs, p.Timestamps, p.Bodies, p.RowCount, p.ByteSize, p.FetchedAt, p.VisibilityTimeoutSeconds})
}

// StreamRow is one row pushed into a StreamPageBuilder.
type StreamRow struct {
	Key       *string
	Headers   string
	Attrs     string
	Timestamp *string
	Body      string
}

// StreamPageBuilder mirrors page.ts's StreamPageBuilder.
type StreamPageBuilder struct {
	visibilityTimeoutSeconds                 *int
	keys, headers, attrs, timestamps, bodies *columnScratch
	rowCount                                 int
}

// NewStreamPageBuilder mirrors page.ts's createStreamPageBuilder.
func NewStreamPageBuilder(visibilityTimeoutSeconds *int) *StreamPageBuilder {
	return &StreamPageBuilder{
		visibilityTimeoutSeconds: visibilityTimeoutSeconds,
		keys:                     newColumnScratch(), headers: newColumnScratch(), attrs: newColumnScratch(),
		timestamps: newColumnScratch(), bodies: newColumnScratch(),
	}
}

func (b *StreamPageBuilder) Push(row StreamRow) {
	i := b.rowCount
	b.keys.appendValue(row.Key, i, MaxCellBytes)
	headers := row.Headers
	b.headers.appendValue(&headers, i, MaxCellBytes)
	attrs := row.Attrs
	b.attrs.appendValue(&attrs, i, MaxCellBytes)
	b.timestamps.appendValue(row.Timestamp, i, MaxCellBytes)
	body := row.Body
	b.bodies.appendValue(&body, i, MaxCellBytes)
	b.rowCount++
}

func (b *StreamPageBuilder) Finish(position PagePosition) StreamPage {
	keys := b.keys.finish(b.rowCount, false)
	headers := b.headers.finish(b.rowCount, false)
	attrs := b.attrs.finish(b.rowCount, false)
	timestamps := b.timestamps.finish(b.rowCount, false)
	bodies := b.bodies.finish(b.rowCount, false)
	return StreamPage{
		Position: position, Keys: keys, Headers: headers, Attrs: attrs, Timestamps: timestamps,
		Bodies: bodies, RowCount: b.rowCount,
		ByteSize: ChunkByteSize(keys) + ChunkByteSize(headers) + ChunkByteSize(attrs) +
			ChunkByteSize(timestamps) + ChunkByteSize(bodies),
		FetchedAt: nowEpochMs(), VisibilityTimeoutSeconds: b.visibilityTimeoutSeconds,
	}
}
