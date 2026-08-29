package repos_test

import (
	"encoding/json"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestTabsSaveListRoundTrip(t *testing.T) {
	r := newTabsRepo(t)
	connID := "conn-1"
	seedConnection(t, r.DB, connID)
	records := []model.TabRecord{
		{ID: "t1", ConnectionID: &connID, Path: "db:table", Kind: "data", State: json.RawMessage(`{"pageSize":100}`), Order: 0, Active: true},
	}
	if err := r.Save(records); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if diff := cmp.Diff(records, got); diff != "" {
		t.Errorf("List() after Save (-want +got):\n%s", diff)
	}
}

func TestTabsSaveDenseReindex(t *testing.T) {
	r := newTabsRepo(t)
	records := []model.TabRecord{
		{ID: "a", Path: "p1", Kind: "console", State: json.RawMessage(`{}`), Order: 7, Active: false},
		{ID: "b", Path: "p2", Kind: "console", State: json.RawMessage(`{}`), Order: 3, Active: false},
		{ID: "c", Path: "p3", Kind: "console", State: json.RawMessage(`{}`), Order: 9, Active: true},
	}
	if err := r.Save(records); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("List() len = %d, want 3", len(got))
	}
	for i, rec := range got {
		if rec.Order != i {
			t.Errorf("record %s Order = %d, want %d (dense reindex by array position)", rec.ID, rec.Order, i)
		}
	}
}

func TestTabsSaveConnectionIDNull(t *testing.T) {
	r := newTabsRepo(t)
	records := []model.TabRecord{
		{ID: "a", ConnectionID: nil, Path: "p", Kind: "console", State: json.RawMessage(`{}`), Order: 0, Active: false},
	}
	if err := r.Save(records); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 1 || got[0].ConnectionID != nil {
		t.Errorf("List() = %+v, want one record with nil ConnectionID", got)
	}
}

func TestTabsListDropsBadRows(t *testing.T) {
	tests := []struct {
		name  string
		state string
		kind  string
	}{
		{"invalid JSON state", "not json", "data"},
		{"non-object state", "[]", "data"},
		{"unknown kind", "{}", "banana"},
		{"legacy ddl kind is not coerced, just dropped", "{}", "ddl"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newTabsRepo(t)
			if _, err := r.DB.Exec(
				`INSERT INTO tabs (id, connection_id, path, kind, state_json, "order", active) VALUES ('x', NULL, 'p', ?, ?, 0, 0)`,
				tt.kind, tt.state,
			); err != nil {
				t.Fatalf("seed: %v", err)
			}
			got, err := r.List()
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			if len(got) != 0 {
				t.Errorf("List() = %+v, want empty (row should be dropped)", got)
			}
		})
	}
}
