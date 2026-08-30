package bridge_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func newQueriesService(t *testing.T) *bridge.QueriesService {
	t.Helper()
	deps, r, _ := newTestDeps(t)
	seedConnectionRow(t, r, "c1")
	return &bridge.QueriesService{Deps: deps}
}

func TestSaveAndListFilters(t *testing.T) {
	svc := newQueriesService(t)
	where := "id = 1"
	orderBy := &model.SortSpec{Kind: "structured", Terms: []model.SortTerm{{Column: "id", Direction: "asc"}}}
	saved, err := svc.Save(bridge.QueriesSaveArgs{
		ConnectionID: "c1", Path: "table:orders", Name: "My filter",
		Body: model.FilterBody{Where: &where, OrderBy: orderBy}, Pinned: true,
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Kind != "filter" || !saved.Pinned {
		t.Fatalf("saved = %+v, want kind=filter pinned=true", saved)
	}

	var body model.FilterBody
	if err := json.Unmarshal(saved.Body, &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Where == nil || *body.Where != where {
		t.Errorf("body.Where = %v, want %q", body.Where, where)
	}
	if body.OrderBy == nil || body.OrderBy.Kind != "structured" {
		t.Errorf("body.OrderBy = %+v, want the structured SortSpec", body.OrderBy)
	}

	textOrderBy := &model.SortSpec{Kind: "text", Text: "id desc"}
	saved2, err := svc.Save(bridge.QueriesSaveArgs{
		ConnectionID: "c1", Path: "table:orders", Name: "Text sort",
		Body: model.FilterBody{OrderBy: textOrderBy},
	})
	if err != nil {
		t.Fatalf("Save (text sort): %v", err)
	}
	var body2 model.FilterBody
	if err := json.Unmarshal(saved2.Body, &body2); err != nil {
		t.Fatalf("decode body2: %v", err)
	}
	if body2.OrderBy == nil || body2.OrderBy.Kind != "text" || body2.OrderBy.Text != "id desc" {
		t.Errorf("body2.OrderBy = %+v, want text sort \"id desc\"", body2.OrderBy)
	}

	list, err := svc.List(bridge.QueriesListArgs{ConnectionID: "c1", Path: "table:orders"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List() returned %d rows, want 2", len(list))
	}
}

func TestSaveAndListConsole(t *testing.T) {
	svc := newQueriesService(t)
	if _, err := svc.Save(bridge.QueriesSaveArgs{
		ConnectionID: "c1", Path: "table:orders", Name: "A filter",
		Body: model.FilterBody{},
	}); err != nil {
		t.Fatalf("Save (filter): %v", err)
	}
	if _, err := svc.SaveConsole(bridge.QueriesSaveConsoleArgs{
		ConnectionID: "c1", Path: "table:orders", Name: "A console",
		Body: model.ConsoleBody{Text: "SELECT 1"},
	}); err != nil {
		t.Fatalf("SaveConsole: %v", err)
	}

	filters, err := svc.List(bridge.QueriesListArgs{ConnectionID: "c1", Path: "table:orders"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(filters) != 1 || filters[0].Kind != "filter" {
		t.Fatalf("List() = %+v, want exactly one filter row", filters)
	}

	console, err := svc.ListConsole(bridge.QueriesListArgs{ConnectionID: "c1", Path: "table:orders"})
	if err != nil {
		t.Fatalf("ListConsole: %v", err)
	}
	if len(console) != 1 || console[0].Kind != "console" {
		t.Fatalf("ListConsole() = %+v, want exactly one console row", console)
	}
}

func TestUpdateRenameAndPin(t *testing.T) {
	svc := newQueriesService(t)
	saved, err := svc.Save(bridge.QueriesSaveArgs{ConnectionID: "c1", Path: "table:orders", Name: "Original", Body: model.FilterBody{}})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}

	renamed, err := svc.Update(bridge.QueriesUpdateArgs{ID: saved.ID, Name: strPtrQT("Renamed")})
	if err != nil {
		t.Fatalf("Update (name only): %v", err)
	}
	if renamed.Name != "Renamed" || renamed.Pinned {
		t.Errorf("after name-only update: %+v, want Name=Renamed Pinned=false", renamed)
	}

	pinned, err := svc.Update(bridge.QueriesUpdateArgs{ID: saved.ID, Pinned: boolPtrQT(true)})
	if err != nil {
		t.Fatalf("Update (pinned only): %v", err)
	}
	if pinned.Name != "Renamed" || !pinned.Pinned {
		t.Errorf("after pinned-only update: %+v, want Name=Renamed (unchanged) Pinned=true", pinned)
	}

	both, err := svc.Update(bridge.QueriesUpdateArgs{ID: saved.ID, Name: strPtrQT("Both"), Pinned: boolPtrQT(false)})
	if err != nil {
		t.Fatalf("Update (both): %v", err)
	}
	if both.Name != "Both" || both.Pinned {
		t.Errorf("after both update: %+v, want Name=Both Pinned=false", both)
	}
}

func TestDeleteAndTouch(t *testing.T) {
	svc := newQueriesService(t)
	saved, err := svc.Save(bridge.QueriesSaveArgs{ConnectionID: "c1", Path: "table:orders", Name: "X", Body: model.FilterBody{}})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := svc.Touch(bridge.QueriesIDArgs{ID: saved.ID}); err != nil {
		t.Fatalf("Touch: %v", err)
	}
	after, err := svc.List(bridge.QueriesListArgs{ConnectionID: "c1", Path: "table:orders"})
	if err != nil {
		t.Fatalf("List after touch: %v", err)
	}
	row := findByID(after, saved.ID)
	if row == nil || row.UsedAt == nil {
		t.Fatalf("row after Touch = %v, want UsedAt set", row)
	}
	if row.Name != saved.Name || row.Kind != saved.Kind {
		t.Errorf("Touch changed unrelated fields: %+v", row)
	}

	if err := svc.Delete(bridge.QueriesIDArgs{ID: saved.ID}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	final, err := svc.List(bridge.QueriesListArgs{ConnectionID: "c1", Path: "table:orders"})
	if err != nil {
		t.Fatalf("List after delete: %v", err)
	}
	if len(final) != 0 {
		t.Errorf("List() after Delete = %+v, want empty", final)
	}
}

func findByID(list []model.SavedQuery, id string) *model.SavedQuery {
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
}

func TestHistoryRecordAndList(t *testing.T) {
	svc := newQueriesService(t)
	where := "id = 1"
	orderBy := &model.SortSpec{Kind: "text", Text: "id desc"}
	if err := svc.HistoryRecord(bridge.QueriesHistoryRecordArgs{
		ConnectionID: "c1", Path: "table:orders", Where: &where, OrderBy: orderBy,
	}); err != nil {
		t.Fatalf("HistoryRecord: %v", err)
	}
	if err := svc.HistoryRecord(bridge.QueriesHistoryRecordArgs{
		ConnectionID: "c1", Path: "table:orders", Where: strPtrQT("id = 2"), OrderBy: nil,
	}); err != nil {
		t.Fatalf("HistoryRecord (nil orderBy): %v", err)
	}

	list, err := svc.HistoryList(bridge.QueriesHistoryListArgs{ConnectionID: "c1", Path: "table:orders", Limit: 10})
	if err != nil {
		t.Fatalf("HistoryList: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("HistoryList() = %+v, want 2 entries", list)
	}
	// Most recently recorded first.
	if list[0].Where == nil || *list[0].Where != "id = 2" || list[0].OrderBy != nil {
		t.Errorf("list[0] = %+v, want where=\"id = 2\" orderBy=nil", list[0])
	}
	if list[1].Where == nil || *list[1].Where != where || list[1].OrderBy == nil {
		t.Errorf("list[1] = %+v, want where=%q orderBy set", list[1], where)
	}
}

func TestHistoryListLimitGuard(t *testing.T) {
	svc := newQueriesService(t)
	tests := []struct {
		limit int
		want  bool // true = accepted
	}{
		{0, false}, {-1, false}, {101, false}, {1, true}, {100, true},
	}
	for _, tt := range tests {
		_, err := svc.HistoryList(bridge.QueriesHistoryListArgs{ConnectionID: "c1", Path: "table:orders", Limit: tt.limit})
		if tt.want {
			if err != nil {
				t.Errorf("HistoryList(limit=%d): %v, want success", tt.limit, err)
			}
			continue
		}
		if err == nil {
			t.Fatalf("HistoryList(limit=%d): want an error", tt.limit)
		}
		var ie *ipcerr.Error
		if !errors.As(err, &ie) || ie.Code != "E_BAD_REQUEST" || ie.Message != "limit must be between 1 and 100" {
			t.Errorf("HistoryList(limit=%d) error = %v, want E_BAD_REQUEST \"limit must be between 1 and 100\"", tt.limit, err)
		}
	}
}

func TestQueriesEmptyIdGuards(t *testing.T) {
	svc := newQueriesService(t)
	tests := []struct {
		name string
		call func() error
	}{
		{"List", func() error { _, err := svc.List(bridge.QueriesListArgs{}); return err }},
		{"ListConsole", func() error { _, err := svc.ListConsole(bridge.QueriesListArgs{}); return err }},
		{"Save", func() error { _, err := svc.Save(bridge.QueriesSaveArgs{}); return err }},
		{"SaveConsole", func() error { _, err := svc.SaveConsole(bridge.QueriesSaveConsoleArgs{}); return err }},
		{"Update", func() error { _, err := svc.Update(bridge.QueriesUpdateArgs{}); return err }},
		{"Delete", func() error { return svc.Delete(bridge.QueriesIDArgs{}) }},
		{"Touch", func() error { return svc.Touch(bridge.QueriesIDArgs{}) }},
		{"HistoryList", func() error { _, err := svc.HistoryList(bridge.QueriesHistoryListArgs{Limit: 10}); return err }},
		{"HistoryRecord", func() error { return svc.HistoryRecord(bridge.QueriesHistoryRecordArgs{}) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.call()
			if err == nil {
				t.Fatalf("%s with an empty id: want an error", tt.name)
			}
			var ie *ipcerr.Error
			if !errors.As(err, &ie) || ie.Code != "E_BAD_REQUEST" {
				t.Errorf("%s error = %v, want E_BAD_REQUEST", tt.name, err)
			}
		})
	}

	list, err := svc.List(bridge.QueriesListArgs{ConnectionID: "c1"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("a guarded call touched a row: List() = %+v, want empty", list)
	}
}

func TestNameValidationIsNotDuplicated(t *testing.T) {
	svc := newQueriesService(t)
	longName := make([]byte, 200)
	for i := range longName {
		longName[i] = 'a'
	}
	_, err := svc.Save(bridge.QueriesSaveArgs{ConnectionID: "c1", Path: "table:orders", Name: string(longName), Body: model.FilterBody{}})
	if err == nil {
		t.Fatalf("Save with a 200-character name: want an error")
	}
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	if ie.Message != "repos/saved_queries: model: saved query name exceeds 120 characters" {
		t.Errorf("Message = %q, want the repo's own model.ValidSavedQueryName wording, not a bridge-invented one", ie.Message)
	}
}

func strPtrQT(s string) *string { return &s }
func boolPtrQT(b bool) *bool    { return &b }
