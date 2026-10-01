package repos

import (
	"slices"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

func TestCodeReposRepo_Reorder(t *testing.T) {
	dir := t.TempDir()
	db, err := storage.OpenAt(dir)
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := &CodeReposRepo{DB: db.DB}

	for _, id := range []string{"A", "B", "C"} {
		if _, err := repo.Create(model.CodeRepo{ID: id, Name: id, Root: "/" + id, RepoID: "r" + id}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	order := func(list []model.CodeRepo) []string {
		out := make([]string, len(list))
		for i, r := range list {
			out[i] = r.ID
		}
		return out
	}

	got, err := repo.Reorder([]string{"C", "A", "B"})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}
	if !slices.Equal(order(got), []string{"C", "A", "B"}) {
		t.Fatalf("order = %v", order(got))
	}
	for i, r := range got {
		if r.SortOrder != i {
			t.Fatalf("%s sort_order = %d, want %d", r.ID, r.SortOrder, i)
		}
	}

	if got, err = repo.Reorder([]string{"B", "X"}); err != nil {
		t.Fatalf("reorder unknown: %v", err)
	}
	if !slices.Equal(order(got), []string{"B", "C", "A"}) {
		t.Fatalf("unknown skipped / unlisted appended: order = %v", order(got))
	}

	if err := repo.Remove("B"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := repo.Create(model.CodeRepo{ID: "D", Name: "D", Root: "/D", RepoID: "rD"}); err != nil {
		t.Fatalf("create D: %v", err)
	}
	if got, err = repo.List(); err != nil {
		t.Fatalf("list: %v", err)
	}
	if !slices.Equal(order(got), []string{"C", "A", "D"}) {
		t.Fatalf("after remove+create: order = %v", order(got))
	}

	_ = db.Close()
	db2, err := storage.OpenAt(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = db2.Close() })
	reread, err := (&CodeReposRepo{DB: db2.DB}).List()
	if err != nil {
		t.Fatalf("list reopened: %v", err)
	}
	if !slices.Equal(order(reread), []string{"C", "A", "D"}) {
		t.Fatalf("order after reopen = %v", order(reread))
	}
}
