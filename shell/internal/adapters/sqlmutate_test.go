package adapters

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func strp(s string) *string { return &s }

func rowValues(pairs ...any) model.RowValues {
	var out model.RowValues
	for i := 0; i < len(pairs); i += 2 {
		name := pairs[i].(string)
		var value *string
		if s, ok := pairs[i+1].(string); ok {
			value = &s
		}
		out = append(out, model.RowValue{Name: name, Value: value})
	}
	return out
}

// OrderedOps must be stable: two ops of the same kind keep their plan order (A4's own emphasis —
// sort.SliceStable, not sort.Slice).
func TestOrderedOps_StableWithinKind(t *testing.T) {
	ops := []model.MutationRowOp{
		{Kind: "insert", Values: rowValues("a", "1")},
		{Kind: "delete", Key: rowValues("id", "1")},
		{Kind: "insert", Values: rowValues("a", "2")},
		{Kind: "update", Key: rowValues("id", "2"), Changes: rowValues("a", "3")},
		{Kind: "delete", Key: rowValues("id", "2")},
	}
	got := OrderedOps(ops)
	wantKinds := []string{"delete", "delete", "update", "insert", "insert"}
	for i, k := range wantKinds {
		if got[i].Kind != k {
			t.Fatalf("position %d: got kind %q, want %q", i, got[i].Kind, k)
		}
	}
	// The two deletes and two inserts must keep their original relative order.
	if got[0].Key[0].Value == nil || *got[0].Key[0].Value != "1" {
		t.Errorf("first delete lost its identity: %+v", got[0])
	}
	if got[1].Key[0].Value == nil || *got[1].Key[0].Value != "2" {
		t.Errorf("second delete lost its identity: %+v", got[1])
	}
	if got[3].Values[0].Value == nil || *got[3].Values[0].Value != "1" {
		t.Errorf("first insert lost its identity: %+v", got[3])
	}
	if got[4].Values[0].Value == nil || *got[4].Values[0].Value != "2" {
		t.Errorf("second insert lost its identity: %+v", got[4])
	}
}

// RenderRowOp must emit columns in the wire's own key order (A4) — a map would randomise this.
func TestRenderRowOp_PreservesColumnOrder(t *testing.T) {
	quote := func(s string) string { return `"` + s + `"` }
	render := NewParamRenderer(func(n int) string { return "$" + itoa(int64(n)) })
	var params []any

	insert := model.MutationRowOp{
		Kind:   "insert",
		Values: rowValues("tenant_id", "3", "entity_id", "1", "name", "new tenant"),
	}
	got := RenderRowOp(`"app"."composite_pk"`, insert, render, &params, quote)
	want := `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ($1, $2, $3)`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}

	params = nil
	del := model.MutationRowOp{
		Kind: "delete",
		Key:  rowValues("tenant_id", "2", "entity_id", "1"),
	}
	got = RenderRowOp(`"app"."composite_pk"`, del, render, &params, quote)
	want = `DELETE FROM "app"."composite_pk" WHERE "tenant_id" = $1 AND "entity_id" = $2`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestLiteralRenderer(t *testing.T) {
	if got := LiteralRenderer(nil); got != "NULL" {
		t.Errorf("got %q, want NULL", got)
	}
	if got := LiteralRenderer(strp("it's")); got != "'it''s'" {
		t.Errorf("got %q, want 'it''s'", got)
	}
}

func TestAssertKeyIsPrimaryKey(t *testing.T) {
	if err := AssertKeyIsPrimaryKey(nil, rowValues("id", "1"), "t"); err == nil {
		t.Error("expected an error for a table with no primary key")
	}
	if err := AssertKeyIsPrimaryKey([]string{"id"}, rowValues("id", "1", "extra", "x"), "t"); err == nil {
		t.Error("expected an error when the key has more than the primary key columns")
	}
	if err := AssertKeyIsPrimaryKey([]string{"a", "b"}, rowValues("b", "1", "a", "2"), "t"); err != nil {
		t.Errorf("expected the primary key columns in any order to be accepted: %v", err)
	}
}

func TestResolveDatabaseTablePath(t *testing.T) {
	path := model.NodePath{Segments: []model.PathSegment{
		{Kind: "database", Name: "app"}, {Kind: "table", Name: "users"},
	}}
	db, table, err := ResolveDatabaseTablePath(path)
	if err != nil || db != "app" || table != "users" {
		t.Errorf("got (%q, %q, %v)", db, table, err)
	}

	bad := model.NodePath{Segments: []model.PathSegment{{Kind: "database", Name: "app"}}}
	if _, _, err := ResolveDatabaseTablePath(bad); err == nil {
		t.Error("expected an error for a one-segment path")
	}
}

func TestAssertColumnsKnown(t *testing.T) {
	columns := []model.ColumnMeta{{Name: "id"}, {Name: "name"}}
	if err := AssertColumnsKnown(columns, []string{"id", "name"}); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	err := AssertColumnsKnown(columns, []string{"nope"})
	if code, ok := CodeOf(err); !ok || code != CodeNotFound {
		t.Fatalf("got %v, want E_NOT_FOUND", err)
	}
	if !strings.Contains(err.Error(), "nope") {
		t.Errorf("message %q does not name the unknown column", err.Error())
	}
}
