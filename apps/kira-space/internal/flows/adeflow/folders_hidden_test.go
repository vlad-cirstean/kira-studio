package adeflow_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestHideFolder(t *testing.T) {
	app := flowharness.New(t)
	folder := filepath.Join(app.Work, "folder")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"one", "two"} {
		flowharness.NewRepo(t, filepath.Join(folder, name)).Commit("base", map[string]string{"a.txt": "a\n"})
	}
	if _, err := app.W.AdeTask.AddFolder(ctx, adewire.FolderArgs{Path: folder}); err != nil {
		t.Fatal(err)
	}

	hiddenByName := func() map[string]bool {
		list, err := app.W.CodeWorkspace.ListRepos()
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, r := range list {
			out[r.Name] = r.Hidden
		}
		return out
	}
	assertHidden := func(want map[string]bool) {
		t.Helper()
		got := hiddenByName()
		if len(got) != len(want) {
			t.Fatalf("hidden flags = %v, want %v", got, want)
		}
		for name, w := range want {
			if got[name] != w {
				t.Fatalf("hidden flags = %v, want %v", got, want)
			}
		}
	}

	f, err := app.W.AdeTask.SetFolderHidden(ctx, adewire.FolderHiddenArgs{Path: folder, Hidden: true})
	if err != nil || !f.Hidden || f.HiddenCount != 2 || f.RepoCount != 2 {
		t.Fatalf("SetFolderHidden = %+v, %v, want hidden with 2 of 2", f, err)
	}
	app.Contract(t, "repos-hidden", "AdeTaskService.SetFolderHidden", f)
	assertHidden(map[string]bool{"one": true, "two": true})

	// A rescan imports a late discovery hidden and leaves the known rows alone.
	flowharness.NewRepo(t, filepath.Join(folder, "three")).Commit("base", map[string]string{"a.txt": "a\n"})
	if _, err := app.W.AdeTask.AddFolder(ctx, adewire.FolderArgs{Path: folder}); err != nil {
		t.Fatal(err)
	}
	assertHidden(map[string]bool{"one": true, "two": true, "three": true})

	// One repo shown inside a hidden folder stays shown across a rescan.
	list, _ := app.W.CodeWorkspace.ListRepos()
	var oneID string
	for _, r := range list {
		if r.Name == "one" {
			oneID = r.ID
		}
	}
	if _, err := app.W.CodeWorkspace.SetRepoHidden(bridge.CodeWorkspaceSetHiddenArgs{ID: oneID, Hidden: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.W.AdeTask.AddFolder(ctx, adewire.FolderArgs{Path: folder}); err != nil {
		t.Fatal(err)
	}
	assertHidden(map[string]bool{"one": false, "two": true, "three": true})

	if f, err = app.W.AdeTask.SetFolderHidden(ctx, adewire.FolderHiddenArgs{Path: folder, Hidden: false}); err != nil || f.Hidden || f.HiddenCount != 0 {
		t.Fatalf("unhide folder = %+v, %v, want none hidden", f, err)
	}
	assertHidden(map[string]bool{"one": false, "two": false, "three": false})

	if _, err := app.W.AdeTask.SetFolderHidden(ctx, adewire.FolderHiddenArgs{Path: filepath.Join(app.Work, "nope"), Hidden: true}); err == nil {
		t.Fatal("SetFolderHidden on an unknown folder succeeded")
	}

	// RemoveFolder keeps the flags the repos carry.
	if _, err := app.W.AdeTask.SetFolderHidden(ctx, adewire.FolderHiddenArgs{Path: folder, Hidden: true}); err != nil {
		t.Fatal(err)
	}
	if err := app.W.AdeTask.RemoveFolder(ctx, adewire.PathArgs{Path: folder}); err != nil {
		t.Fatal(err)
	}
	assertHidden(map[string]bool{"one": true, "two": true, "three": true})
}
