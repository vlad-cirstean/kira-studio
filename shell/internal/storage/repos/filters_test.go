package repos_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestFiltersReplaceListRoundTrip(t *testing.T) {
	r := newFiltersRepo(t)
	seedConnection(t, r.DB, "c1")
	vis := model.TreeVisibility{HiddenKinds: []string{"table", "view"}, HiddenPaths: []string{"db:a", "db:b"}}
	got, err := r.Replace("c1", vis)
	if err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if diff := cmp.Diff(vis.HiddenKinds, got.HiddenKinds); diff != "" {
		t.Errorf("HiddenKinds (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(vis.HiddenPaths, got.HiddenPaths); diff != "" {
		t.Errorf("HiddenPaths (-want +got):\n%s", diff)
	}

	got2, err := r.List("c1")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if diff := cmp.Diff(got, got2); diff != "" {
		t.Errorf("List() vs Replace() result (-replace +list):\n%s", diff)
	}
}

func TestFiltersReplaceWithEmptyClears(t *testing.T) {
	r := newFiltersRepo(t)
	seedConnection(t, r.DB, "c1")
	if _, err := r.Replace("c1", model.TreeVisibility{HiddenKinds: []string{"table"}}); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	got, err := r.Replace("c1", model.EmptyVisibility())
	if err != nil {
		t.Fatalf("Replace(empty): %v", err)
	}
	if len(got.HiddenKinds) != 0 || len(got.HiddenPaths) != 0 {
		t.Errorf("Replace(empty) = %+v, want both empty", got)
	}
}

func TestFiltersReplaceAbsorbsDuplicates(t *testing.T) {
	r := newFiltersRepo(t)
	seedConnection(t, r.DB, "c1")
	got, err := r.Replace("c1", model.TreeVisibility{HiddenKinds: []string{"table", "table"}})
	if err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if len(got.HiddenKinds) != 1 {
		t.Errorf("Replace() with duplicate input = %+v, want one entry", got.HiddenKinds)
	}
}

func TestFiltersListIgnoresUnrecognisedScope(t *testing.T) {
	r := newFiltersRepo(t)
	seedConnection(t, r.DB, "c1")
	if _, err := r.DB.Exec(
		`INSERT INTO connection_tree_filters (connection_id, scope, value) VALUES ('c1', 'weird', 'x')`,
	); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := r.List("c1")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got.HiddenKinds) != 0 || len(got.HiddenPaths) != 0 {
		t.Errorf("List() with unrecognised scope = %+v, want both empty", got)
	}
}

func TestFiltersPerConnectionIsolation(t *testing.T) {
	r := newFiltersRepo(t)
	seedConnection(t, r.DB, "c1")
	if _, err := r.Replace("c1", model.TreeVisibility{HiddenKinds: []string{"table"}}); err != nil {
		t.Fatalf("Replace c1: %v", err)
	}
	got, err := r.List("c2")
	if err != nil {
		t.Fatalf("List c2: %v", err)
	}
	if len(got.HiddenKinds) != 0 {
		t.Errorf("List(c2) = %+v after only c1 was written, want empty", got)
	}
}
