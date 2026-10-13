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

func TestApplyFolderHiddenSkipsChangedRepos(t *testing.T) {
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	codeRepos := &CodeReposRepo{DB: db.DB}
	cfg := &AdeRepoConfigRepo{DB: db.DB}
	const folder = "/work"
	if err := cfg.AddFolder(folder, false); err != nil {
		t.Fatal(err)
	}
	var imported []ImportedRepo
	for _, id := range []string{"A", "B"} {
		rec, err := codeRepos.Create(model.CodeRepo{ID: id, Name: id, Root: "/" + id, RepoID: "r" + id})
		if err != nil {
			t.Fatal(err)
		}
		imported = append(imported, ImportedRepo{ID: id, Rev: rec.HiddenRev})
	}
	// The flip lands mid-scan: A has its source set, B not yet.
	if err := cfg.SetSource("A", folder); err != nil {
		t.Fatal(err)
	}
	if ok, err := cfg.SetFolderHidden(folder, true); err != nil || !ok {
		t.Fatalf("SetFolderHidden = %v, %v", ok, err)
	}
	if _, err := codeRepos.SetHidden("A", false); err != nil {
		t.Fatal(err)
	}
	if err := cfg.SetSource("B", folder); err != nil {
		t.Fatal(err)
	}
	if err := cfg.ApplyFolderHidden(folder, imported); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{"A": false, "B": true} {
		got, err := codeRepos.Get(id)
		if err != nil || got == nil || got.Hidden != want {
			t.Errorf("repo %s hidden = %+v, %v, want %v", id, got, err, want)
		}
	}
}
