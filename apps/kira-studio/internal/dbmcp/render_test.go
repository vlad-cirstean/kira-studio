package dbmcp

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/page"
)

// TestRenderTabularPageNullVersusEmptyString is §8's own named hazard: a NULL row and an empty
// string both have Offsets[i] == Offsets[i+1], and only the Nulls bitset (page.IsNull) tells them
// apart. Getting cellAt backwards renders NULL as "" — valid JSON a model would reason over
// incorrectly, with nothing failing anywhere.
func TestRenderTabularPageNullVersusEmptyString(t *testing.T) {
	b := page.NewTabularPageBuilder([]page.ColumnDescriptor{
		{Name: "id", DataType: "int4", TypeClass: page.TypeClassNumber},
		{Name: "note", DataType: "text", TypeClass: page.TypeClassText},
	})
	one := "1"
	empty := ""
	if err := b.AppendRow([]*string{&one, &empty}); err != nil {
		t.Fatalf("AppendRow (empty string row): %v", err)
	}
	if err := b.AppendRow([]*string{nil, nil}); err != nil {
		t.Fatalf("AppendRow (NULL row): %v", err)
	}
	pg := b.Finish(page.UnpagedPosition(2))

	rendered := renderTabularPage(pg, 200)
	if rendered.Kind != "tabular" {
		t.Fatalf("Kind = %q, want tabular", rendered.Kind)
	}
	if len(rendered.Rows) != 2 {
		t.Fatalf("len(Rows) = %d, want 2", len(rendered.Rows))
	}

	// Row 0: an explicit empty string, not NULL.
	if rendered.Rows[0][1] == nil {
		t.Fatal("row 0 col 1 (empty string) rendered as NULL, want a non-nil pointer to \"\"")
	}
	if *rendered.Rows[0][1] != "" {
		t.Fatalf("row 0 col 1 = %q, want empty string", *rendered.Rows[0][1])
	}

	// Row 1: a genuine NULL in both columns.
	if rendered.Rows[1][0] != nil {
		t.Fatalf("row 1 col 0 (NULL) rendered as %q, want nil", *rendered.Rows[1][0])
	}
	if rendered.Rows[1][1] != nil {
		t.Fatalf("row 1 col 1 (NULL) rendered as %q, want nil", *rendered.Rows[1][1])
	}
}

// TestRenderTabularPageTruncation covers maxRows capping and TruncatedCells surfacing (§5.2:
// "truncatedCells... surfaced so a client never treats a clipped value as complete").
func TestRenderTabularPageTruncation(t *testing.T) {
	b := page.NewTabularPageBuilder([]page.ColumnDescriptor{
		{Name: "v", DataType: "text", TypeClass: page.TypeClassText},
	})
	huge := make([]byte, page.MaxCellBytes+10)
	for i := range huge {
		huge[i] = 'x'
	}
	hugeStr := string(huge)
	if err := b.AppendRow([]*string{&hugeStr}); err != nil {
		t.Fatalf("AppendRow: %v", err)
	}
	for i := 0; i < 3; i++ {
		v := "small"
		if err := b.AppendRow([]*string{&v}); err != nil {
			t.Fatalf("AppendRow: %v", err)
		}
	}
	pg := b.Finish(page.UnpagedPosition(4))
	if pg.TruncatedCells == 0 {
		t.Fatal("builder did not truncate the oversized cell — test setup is wrong, not the code under test")
	}

	rendered := renderTabularPage(pg, 2)
	if rendered.RowCount != 4 {
		t.Fatalf("RowCount = %d, want 4 (the full result, not the capped one)", rendered.RowCount)
	}
	if rendered.Returned != 2 {
		t.Fatalf("Returned = %d, want 2 (capped by maxRows)", rendered.Returned)
	}
	if len(rendered.Rows) != 2 {
		t.Fatalf("len(Rows) = %d, want 2", len(rendered.Rows))
	}
	if !rendered.Truncated {
		t.Fatal("Truncated = false, want true (Returned < RowCount)")
	}
	if rendered.TruncatedCells != pg.TruncatedCells {
		t.Fatalf("TruncatedCells = %d, want %d (the builder's own count, verbatim)", rendered.TruncatedCells, pg.TruncatedCells)
	}
}

func TestRenderDocumentPage(t *testing.T) {
	b := page.NewDocumentPageBuilder(false)
	b.Push("id-1", `{"a":1}`)
	b.Push("id-2", `{"b":2}`)
	pg := b.Finish(page.UnpagedPosition(2))

	rendered := renderDocumentPage(pg, 200)
	if rendered.Kind != "document" {
		t.Fatalf("Kind = %q, want document", rendered.Kind)
	}
	if len(rendered.Documents) != 2 {
		t.Fatalf("len(Documents) = %d, want 2", len(rendered.Documents))
	}
	if rendered.Documents[0].ID == nil || *rendered.Documents[0].ID != "id-1" {
		t.Fatalf("Documents[0].ID = %v, want \"id-1\"", rendered.Documents[0].ID)
	}
	if rendered.Documents[1].Body == nil || *rendered.Documents[1].Body != `{"b":2}` {
		t.Fatalf("Documents[1].Body = %v, want {\"b\":2}", rendered.Documents[1].Body)
	}
}

func TestRenderKeyValuePage(t *testing.T) {
	ttl := int64(1000)
	mem := int64(2048)
	b := page.NewKeyValuePageBuilder("hash", &ttl, &mem, false)
	b.Push("field1", "value1")
	pg := b.Finish(page.UnpagedPosition(1))

	rendered := renderKeyValuePage(pg, 200)
	if rendered.Kind != "keyvalue" {
		t.Fatalf("Kind = %q, want keyvalue", rendered.Kind)
	}
	if rendered.RedisType != "hash" {
		t.Fatalf("RedisType = %q, want hash", rendered.RedisType)
	}
	if rendered.TTLMs == nil || *rendered.TTLMs != 1000 {
		t.Fatalf("TTLMs = %v, want 1000", rendered.TTLMs)
	}
	if len(rendered.Entries) != 1 || *rendered.Entries[0].Field != "field1" || *rendered.Entries[0].Value != "value1" {
		t.Fatalf("Entries = %+v, want one {field1 value1}", rendered.Entries)
	}
}

func TestRenderStreamPage(t *testing.T) {
	b := page.NewStreamPageBuilder(nil)
	key := "k1"
	ts := "2024-01-01T00:00:00Z"
	b.Push(page.StreamRow{Key: &key, Headers: "{}", Attrs: "{}", Timestamp: &ts, Body: "payload"})
	pg := b.Finish(page.UnpagedPosition(1))

	rendered := renderStreamPage(pg, 200)
	if rendered.Kind != "stream" {
		t.Fatalf("Kind = %q, want stream", rendered.Kind)
	}
	if len(rendered.Messages) != 1 {
		t.Fatalf("len(Messages) = %d, want 1", len(rendered.Messages))
	}
	msg := rendered.Messages[0]
	if msg.Key == nil || *msg.Key != "k1" {
		t.Fatalf("Messages[0].Key = %v, want k1", msg.Key)
	}
	if msg.Body == nil || *msg.Body != "payload" {
		t.Fatalf("Messages[0].Body = %v, want payload", msg.Body)
	}
}

// TestRenderPageDispatchesByKind covers renderPage's own type switch for all four kinds it knows,
// and confirms an unrecognised page kind returns an error rather than a silent wrong render (§5.2:
// "implement it rather than panicking on the fourth arm of a type switch").
func TestRenderPageDispatchesByKind(t *testing.T) {
	tb := page.NewTabularPageBuilder(nil)
	tabular := tb.Finish(page.UnpagedPosition(0))
	if _, err := renderPage(tabular, 200); err != nil {
		t.Fatalf("renderPage(TabularPage): %v", err)
	}

	db := page.NewDocumentPageBuilder(false)
	doc := db.Finish(page.UnpagedPosition(0))
	if _, err := renderPage(doc, 200); err != nil {
		t.Fatalf("renderPage(DocumentPage): %v", err)
	}

	kvb := page.NewKeyValuePageBuilder("string", nil, nil, false)
	kv := kvb.Finish(page.UnpagedPosition(0))
	if _, err := renderPage(kv, 200); err != nil {
		t.Fatalf("renderPage(KeyValuePage): %v", err)
	}

	sb := page.NewStreamPageBuilder(nil)
	stream := sb.Finish(page.UnpagedPosition(0))
	if _, err := renderPage(stream, 200); err != nil {
		t.Fatalf("renderPage(StreamPage): %v", err)
	}

	if _, err := renderPage(unknownPage{}, 200); err == nil {
		t.Fatal("renderPage(unrecognised kind) = nil error, want an error naming the unhandled type")
	}
}

// unknownPage satisfies page.Page but is none of the four kinds renderPage knows — exercising its
// default arm without needing a fifth real page kind to exist.
type unknownPage struct{}

func (unknownPage) PageKind() page.PageKind { return page.PageKind("unknown") }
func (unknownPage) Size() int               { return 0 }
func (unknownPage) Rows() int               { return 0 }
