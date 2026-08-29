package repos_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestSavedQueriesSaveListRoundTrip(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")

	where := "x = 1"
	filter, err := r.SaveFilter("c1", "db:t", "My Filter", model.FilterBody{Where: &where}, false)
	if err != nil {
		t.Fatalf("SaveFilter: %v", err)
	}
	if filter.Kind != "filter" || filter.Name != "My Filter" {
		t.Errorf("SaveFilter() = %+v", filter)
	}

	console, err := r.SaveConsole("c1", "db:t", "My Console", model.ConsoleBody{Text: "SELECT 1"}, true)
	if err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}
	if console.Kind != "console" || !console.Pinned {
		t.Errorf("SaveConsole() = %+v", console)
	}

	filters, err := r.ListFilters("c1", "db:t")
	if err != nil {
		t.Fatalf("ListFilters: %v", err)
	}
	if len(filters) != 1 || filters[0].ID != filter.ID {
		t.Errorf("ListFilters() = %+v, want just the saved filter", filters)
	}

	consoles, err := r.ListConsole("c1", "db:t")
	if err != nil {
		t.Fatalf("ListConsole: %v", err)
	}
	if len(consoles) != 1 || consoles[0].ID != console.ID {
		t.Errorf("ListConsole() = %+v, want just the saved console query", consoles)
	}
}

func TestSavedQueriesOrdering(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")

	if _, err := r.SaveConsole("c1", "p", "Zebra", model.ConsoleBody{Text: "a"}, false); err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}
	pinned, err := r.SaveConsole("c1", "p", "Apple", model.ConsoleBody{Text: "b"}, true)
	if err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}

	list, err := r.ListConsole("c1", "p")
	if err != nil {
		t.Fatalf("ListConsole: %v", err)
	}
	if len(list) != 2 || list[0].ID != pinned.ID {
		t.Errorf("ListConsole() order = %+v, want the pinned one first", list)
	}
}

func TestSavedQueriesUpdate(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")
	q, err := r.SaveConsole("c1", "p", "Original", model.ConsoleBody{Text: "x"}, false)
	if err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}

	newName := "Renamed"
	updated, err := r.Update(q.ID, model.SavedQueryPatch{Name: &newName})
	if err != nil {
		t.Fatalf("Update name: %v", err)
	}
	if updated.Name != "Renamed" || updated.Pinned {
		t.Errorf("Update(name) = %+v", updated)
	}

	pinTrue := true
	updated2, err := r.Update(q.ID, model.SavedQueryPatch{Pinned: &pinTrue})
	if err != nil {
		t.Fatalf("Update pinned: %v", err)
	}
	if !updated2.Pinned || updated2.Name != "Renamed" {
		t.Errorf("Update(pinned) = %+v, want pinned=true and name unchanged", updated2)
	}
}

func TestSavedQueriesTouch(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")
	q, err := r.SaveConsole("c1", "p", "Q", model.ConsoleBody{Text: "x"}, false)
	if err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}
	time.Sleep(2 * time.Millisecond) // ensure a distinguishable timestamp
	if err := r.Touch(q.ID); err != nil {
		t.Fatalf("Touch: %v", err)
	}
	list, err := r.ListConsole("c1", "p")
	if err != nil {
		t.Fatalf("ListConsole: %v", err)
	}
	if len(list) != 1 || list[0].UsedAt == nil || *list[0].UsedAt == q.CreatedAt {
		t.Errorf("Touch() did not move used_at: %+v", list)
	}
}

func TestSavedQueriesDelete(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")
	q, err := r.SaveConsole("c1", "p", "Q", model.ConsoleBody{Text: "x"}, false)
	if err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}
	if err := r.Delete(q.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	list, err := r.ListConsole("c1", "p")
	if err != nil {
		t.Fatalf("ListConsole: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("ListConsole() after Delete = %+v, want empty", list)
	}
}

func TestSavedQueriesNameValidation(t *testing.T) {
	r := newSavedQueriesRepo(t)
	seedConnection(t, r.DB, "c1")
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"empty", "", true},
		{"whitespace", "   ", true},
		{"121 chars", strings.Repeat("a", 121), true},
		{"ok", "Fine", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := r.SaveConsole("c1", "p", tt.input, model.ConsoleBody{Text: "x"}, false)
			if (err != nil) != tt.wantErr {
				t.Errorf("SaveConsole(name=%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

func TestSavedQueriesListDropsBadRows(t *testing.T) {
	tests := []struct {
		name string
		kind string
		body string
	}{
		{"invalid body JSON", "console", "not json"},
		{"wrong shape for filter kind", "filter", `{"text":"x"}`},
		{"unrecognised kind", "banana", `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newSavedQueriesRepo(t)
			seedConnection(t, r.DB, "c1")
			now := model.NowISO()
			if _, err := r.DB.Exec(
				`INSERT INTO saved_queries (id, connection_id, path, name, kind, body, pinned, created_at, used_at)
				 VALUES ('x', 'c1', 'p', 'n', ?, ?, 0, ?, ?)`,
				tt.kind, tt.body, now, now,
			); err != nil {
				t.Fatalf("seed: %v", err)
			}
			filters, err := r.ListFilters("c1", "p")
			if err != nil {
				t.Fatalf("ListFilters: %v", err)
			}
			consoles, err := r.ListConsole("c1", "p")
			if err != nil {
				t.Fatalf("ListConsole: %v", err)
			}
			if len(filters)+len(consoles) != 0 {
				t.Errorf("row with %s should be dropped, got filters=%+v consoles=%+v", tt.name, filters, consoles)
			}
		})
	}
}
