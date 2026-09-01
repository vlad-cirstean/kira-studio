package repos_test

import (
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

func newTabsRepo(t *testing.T) *repos.TabsRepo {
	return &repos.TabsRepo{DB: newRepos(t).DB}
}

func validTabRecord(id string) model.TabRecord {
	return model.TabRecord{ID: id, Path: "database:app/table:t", Kind: "data", State: json.RawMessage(`{}`)}
}

// P2 R2: Save previously wrote a record with no validation at all — an invalid row round-tripped
// silently (write succeeded, then List's own guards dropped it on the very next read, with
// nothing at the write site to say why). Save must now reject the same shapes List already
// refuses to return, and it must reject the whole batch rather than partially writing it.
func TestTabsRepoSaveRejectsInvalidRecords(t *testing.T) {
	r := newTabsRepo(t)

	cases := []struct {
		name string
		rec  model.TabRecord
	}{
		{"empty id", model.TabRecord{ID: "", Path: "p", Kind: "data", State: json.RawMessage(`{}`)}},
		{"empty path", model.TabRecord{ID: "t1", Path: "", Kind: "data", State: json.RawMessage(`{}`)}},
		{"unrecognised kind", model.TabRecord{ID: "t1", Path: "p", Kind: "ddl", State: json.RawMessage(`{}`)}},
		{"nil state", model.TabRecord{ID: "t1", Path: "p", Kind: "data", State: nil}},
		{"array state", model.TabRecord{ID: "t1", Path: "p", Kind: "data", State: json.RawMessage(`[1,2]`)}},
		{"scalar state", model.TabRecord{ID: "t1", Path: "p", Kind: "data", State: json.RawMessage(`"x"`)}},
		{"malformed state", model.TabRecord{ID: "t1", Path: "p", Kind: "data", State: json.RawMessage(`{`)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := r.Save([]model.TabRecord{tc.rec}); err == nil {
				t.Fatalf("Save(%+v) = nil, want a validation error", tc.rec)
			}
		})
	}
}

// A batch with one bad record must not partially apply — the good record alongside it must not
// be written either, matching Save's existing "clear then reinsert the whole set" semantics.
func TestTabsRepoSaveRejectsWholeBatchOnOneInvalidRecord(t *testing.T) {
	r := newTabsRepo(t)

	good := validTabRecord("t-good")
	bad := model.TabRecord{ID: "t-bad", Path: "p", Kind: "not-a-real-kind", State: json.RawMessage(`{}`)}
	if err := r.Save([]model.TabRecord{good, bad}); err == nil {
		t.Fatal("Save with one invalid record = nil, want an error")
	}

	got, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("List() after a rejected Save = %+v, want no rows written", got)
	}
}

// The straightforward success path: a valid batch round-trips through Save/List unchanged.
func TestTabsRepoSaveAndListRoundTrip(t *testing.T) {
	r := newTabsRepo(t)

	recs := []model.TabRecord{validTabRecord("t1"), validTabRecord("t2")}
	if err := r.Save(recs); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := r.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("List() = %+v, want 2 rows", got)
	}
	if got[0].ID != "t1" || got[1].ID != "t2" {
		t.Errorf("List() ids = [%s, %s], want [t1, t2]", got[0].ID, got[1].ID)
	}
}
