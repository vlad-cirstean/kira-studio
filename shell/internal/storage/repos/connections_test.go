package repos_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func sampleFields(name string) model.ConnectionFields {
	host := "localhost"
	port := 5432
	database := "mydb"
	username := "user"
	preconnect := "echo hi"
	return model.ConnectionFields{
		Name: name, Kind: "postgres", Color: "blue", Mode: "fields", ReadOnly: false,
		Host: &host, Port: &port, Database: &database, Username: &username,
		Options:           map[string]any{"sslmode": "disable"},
		Preconnect:        &preconnect,
		PreconnectSidecar: true,
	}
}

func TestConnectionsInsertGetRoundTrip(t *testing.T) {
	r := newConnectionsRepo(t)
	created, err := r.Insert("c1", sampleFields("My DB"), model.NowISO())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	got, err := r.Get("c1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("Get() = nil, want the inserted row")
	}
	if diff := cmp.Diff(created, *got); diff != "" {
		t.Errorf("Get() vs Insert() result (-insert +get):\n%s", diff)
	}
	if got.Options["sslmode"] != "disable" {
		t.Errorf("Options round trip = %+v", got.Options)
	}
	if got.Preconnect == nil || *got.Preconnect != "echo hi" {
		t.Errorf("Preconnect round trip = %v", got.Preconnect)
	}
}

func TestConnectionsGetMissingReturnsNilNil(t *testing.T) {
	r := newConnectionsRepo(t)
	got, err := r.Get("nope")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Errorf("Get(missing) = %+v, want nil", got)
	}
}

func TestConnectionsSortOrderAssignment(t *testing.T) {
	r := newConnectionsRepo(t)
	for i, name := range []string{"a", "b", "c"} {
		created, err := r.Insert(name, sampleFields(name), model.NowISO())
		if err != nil {
			t.Fatalf("Insert %s: %v", name, err)
		}
		if created.SortOrder != i {
			t.Errorf("Insert(%s).SortOrder = %d, want %d", name, created.SortOrder, i)
		}
	}
}

func TestConnectionsListOrdersBySortOrderThenName(t *testing.T) {
	r := newConnectionsRepo(t)
	if _, err := r.Insert("c1", sampleFields("Zebra"), model.NowISO()); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if _, err := r.Insert("c2", sampleFields("Apple"), model.NowISO()); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	// Force both rows to share a sort_order to exercise the name tiebreak.
	if _, err := r.DB.Exec(`UPDATE connections SET sort_order = 0`); err != nil {
		t.Fatalf("force shared sort_order: %v", err)
	}
	list, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 || list[0].Name != "Apple" || list[1].Name != "Zebra" {
		t.Fatalf("List() with shared sort_order = %+v, want [Apple, Zebra] (name tiebreak)", list)
	}
}

func TestConnectionsReorder(t *testing.T) {
	r := newConnectionsRepo(t)
	for _, name := range []string{"a", "b", "c"} {
		if _, err := r.Insert(name, sampleFields(name), model.NowISO()); err != nil {
			t.Fatalf("Insert %s: %v", name, err)
		}
	}
	reordered, err := r.Reorder([]string{"c", "a", "b"})
	if err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if len(reordered) != 3 || reordered[0].ID != "c" || reordered[1].ID != "a" || reordered[2].ID != "b" {
		t.Fatalf("Reorder() = %+v, want order [c, a, b]", reordered)
	}
}

func TestConnectionsUpdate(t *testing.T) {
	r := newConnectionsRepo(t)
	if _, err := r.Insert("c1", sampleFields("Original"), model.NowISO()); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	updatedFields := sampleFields("Renamed")
	updated, err := r.Update("c1", updatedFields, model.NowISO())
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "Renamed" {
		t.Errorf("Update().Name = %q, want Renamed", updated.Name)
	}
}

func TestConnectionsDeleteCascades(t *testing.T) {
	r := newConnectionsRepo(t)
	if _, err := r.Insert("c1", sampleFields("DB"), model.NowISO()); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	now := model.NowISO()
	seeds := []struct {
		table string
		exec  string
	}{
		{"saved_queries", `INSERT INTO saved_queries (id, connection_id, path, name, kind, body, created_at) VALUES ('sq1', 'c1', 'p', 'n', 'console', '{}', ?)`},
		{"metadata_cache", `INSERT INTO metadata_cache (connection_id, path, kind, payload_json, fetched_at) VALUES ('c1', 'p', 'children', '{}', ?)`},
		{"connection_tree_filters", `INSERT INTO connection_tree_filters (connection_id, scope, value) VALUES ('c1', 'kind', 'table')`},
		{"filter_history", `INSERT INTO filter_history (id, connection_id, path, where_text, order_by_json, used_at) VALUES ('fh1', 'c1', 'p', 'x=1', NULL, ?)`},
	}
	for _, s := range seeds {
		args := []any{}
		if s.table != "connection_tree_filters" {
			args = append(args, now)
		}
		if _, err := r.DB.Exec(s.exec, args...); err != nil {
			t.Fatalf("seed %s: %v", s.table, err)
		}
	}

	if err := r.Delete("c1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	for _, s := range seeds {
		var count int
		if err := r.DB.QueryRow(`SELECT COUNT(*) FROM ` + s.table + ` WHERE connection_id = 'c1'`).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", s.table, err)
		}
		if count != 0 {
			t.Errorf("%s still has %d row(s) referencing deleted connection c1 (ON DELETE CASCADE / foreign_keys pragma not effective)", s.table, count)
		}
	}
}

func TestConnectionsListDropsBadRows(t *testing.T) {
	tests := []struct {
		name    string
		kind    string
		color   string
		mode    string
		options *string
	}{
		{"bad options_json", "postgres", "blue", "fields", strPtr("not json")},
		{"unknown kind", "banana", "blue", "fields", nil},
		{"unknown color", "postgres", "banana", "fields", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newConnectionsRepo(t)
			now := model.NowISO()
			if _, err := r.DB.Exec(
				`INSERT INTO connections (id, name, kind, color, mode, read_only, options_json, created_at, updated_at, sort_order)
				 VALUES ('x', 'n', ?, ?, ?, 0, ?, ?, ?, 0)`,
				tt.kind, tt.color, tt.mode, tt.options, now, now,
			); err != nil {
				t.Fatalf("seed: %v", err)
			}
			list, err := r.List()
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			if len(list) != 0 {
				t.Errorf("List() = %+v, want empty (row should be dropped)", list)
			}
		})
	}
}

func strPtr(s string) *string { return &s }
