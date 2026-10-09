package repoflow_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestImportViaFolderPicker(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("proj")
	r.Commit("init", map[string]string{"a.txt": "a\n"})

	mark := app.Events.Mark()
	rec := importVia(t, app, r.Dir)
	if rec.Root != real(t, r.Dir) || rec.Name != "proj" {
		t.Fatalf("imported %+v, want root %s name proj", rec, r.Dir)
	}
	if len(app.Dialogs.Directory) != 1 {
		t.Fatalf("dialog calls = %d, want 1", len(app.Dialogs.Directory))
	}

	list, err := app.W.CodeWorkspace.ListRepos()
	if err != nil || len(list) != 1 || list[0].ID != rec.ID {
		t.Fatalf("ListRepos = %+v, %v", list, err)
	}
	app.Events.WaitAfter(t, mark, adewire.ChannelRepos, nil, 5*time.Second)
	ade, err := app.W.AdeTask.Repos(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, ar := range ade.Repos {
		found = found || ar.CodeRepoID == rec.ID
	}
	if !found {
		t.Fatalf("ADE Repos %+v lacks %s", ade.Repos, rec.ID)
	}

	t.Run("cancel imports nothing", func(t *testing.T) {
		pick, err := app.W.Files.ChooseFolder(bridge.FilesChooseFolderArgs{})
		if err != nil || !pick.Canceled || pick.Path != nil {
			t.Fatalf("empty dialog = %+v, %v, want canceled", pick, err)
		}
	})

	t.Run("rename, colour and reorder persist", func(t *testing.T) {
		second := app.NewRepo("proj2")
		second.Commit("init", map[string]string{"b.txt": "b\n"})
		rec2 := importVia(t, app, second.Dir)
		if _, err := app.W.CodeWorkspace.RenameRepo(bridge.CodeWorkspaceRenameArgs{ID: rec.ID, Name: "renamed"}); err != nil {
			t.Fatal(err)
		}
		if _, err := app.W.CodeWorkspace.SetRepoColor(bridge.CodeWorkspaceSetColorArgs{ID: rec.ID, Color: "not-a-colour"}); errCode(err) != "E_BAD_REQUEST" {
			t.Fatalf("bad colour err = %v, want E_BAD_REQUEST", err)
		}
		order, err := app.W.CodeWorkspace.ReorderRepos(bridge.CodeWorkspaceReorderArgs{IDs: []string{rec2.ID, rec.ID}})
		if err != nil || len(order) != 2 || order[0].ID != rec2.ID {
			t.Fatalf("ReorderRepos = %+v, %v", order, err)
		}
		app.Restart()
		list, err := app.W.CodeWorkspace.ListRepos()
		if err != nil || len(list) != 2 || list[0].ID != rec2.ID || list[1].Name != "renamed" {
			t.Fatalf("after restart ListRepos = %+v, %v", list, err)
		}
	})
}

func TestImportEdgeCases(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("main-repo")
	r.Commit("init", map[string]string{"a.txt": "a\n"})
	rec := importVia(t, app, r.Dir)

	t.Run("non-repo refused", func(t *testing.T) {
		plain := filepath.Join(app.Work, "plain")
		mustWrite(t, filepath.Join(plain, "f.txt"), []byte("x"))
		_, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: plain})
		if errCode(err) != "E_INVALID" {
			t.Fatalf("err = %v, want E_INVALID", err)
		}
	})

	t.Run("empty path refused", func(t *testing.T) {
		_, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{})
		if errCode(err) != "E_BAD_REQUEST" {
			t.Fatalf("err = %v, want E_BAD_REQUEST", err)
		}
	})

	t.Run("same path twice refused", func(t *testing.T) {
		_, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: r.Dir})
		if errCode(err) != "E_ALREADY_IMPORTED" {
			t.Fatalf("err = %v, want E_ALREADY_IMPORTED", err)
		}
		// A subdirectory resolves to the same worktree root.
		sub := filepath.Join(r.Dir, "sub")
		mustWrite(t, filepath.Join(sub, "x.txt"), []byte("x"))
		_, err = app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: sub})
		if errCode(err) != "E_ALREADY_IMPORTED" {
			t.Fatalf("subdir err = %v, want E_ALREADY_IMPORTED", err)
		}
		list, _ := app.W.CodeWorkspace.ListRepos()
		if len(list) != 1 {
			t.Fatalf("ListRepos = %d rows, want 1", len(list))
		}
	})

	t.Run("bare refused", func(t *testing.T) {
		bare := app.NewBare("remote.git")
		_, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: bare.Dir})
		if errCode(err) != "E_INVALID" {
			t.Fatalf("err = %v, want E_INVALID", err)
		}
	})

	t.Run("linked worktree imports as its own row", func(t *testing.T) {
		wt := r.LinkedWorktree("feature")
		lrec, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: wt.Dir})
		if err != nil {
			t.Fatalf("ImportRepo worktree: %v", err)
		}
		if lrec.ID == rec.ID || lrec.Root != real(t, wt.Dir) {
			t.Fatalf("worktree row %+v vs main %+v", lrec, rec)
		}
	})
}
