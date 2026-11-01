package windowflow_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/openedfiles"
)

func pendingFor(t *testing.T, app *flowharness.App, key string) []openedfiles.Target {
	t.Helper()
	got, err := app.W.OpenedFilesSvc.Pending(bridge.OpenedFilesPendingArgs{WindowKey: key})
	if err != nil {
		t.Fatalf("Pending %s: %v", key, err)
	}
	return got
}

func TestOpenedFilesNewWindow(t *testing.T) {
	app := flowharness.New(t)
	repo := app.NewRepo("proj")
	repo.Commit("init", map[string]string{"src/a.go": "package a\n"})
	rec, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: repo.Dir})
	if err != nil {
		t.Fatalf("ImportRepo: %v", err)
	}

	notes := filepath.Join(app.Work, "notes")
	if err := os.MkdirAll(filepath.Join(notes, "dir.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, text string) string {
		p := filepath.Join(notes, name)
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	loose := write("b.json", "{\"k\": 1}\n")
	txt := write("x.txt", "prose\n")

	app.W.OpenedFiles.Open([]string{filepath.Join(repo.Dir, "src", "a.go"), loose, txt, filepath.Join(notes, "dir.json")})
	if got := len(app.WindowMgr.OpenedKeyed); got != 1 {
		t.Fatalf("keyed windows = %d, want 1", got)
	}
	key := app.WindowMgr.OpenedKeyed[0]

	targets := pendingFor(t, app, key)
	app.Contract(t, "opened-files", "OpenedFilesService.Pending", targets)
	if len(targets) != 2 ||
		targets[0].RepoID != rec.ID || targets[0].RelPath != "src/a.go" || targets[0].Path != "" ||
		targets[1].Path != loose || targets[1].RepoID != "" {
		t.Fatalf("targets = %+v, want repo src/a.go then loose %s", targets, loose)
	}
	if again := pendingFor(t, app, key); len(again) != 0 {
		t.Fatalf("second Pending = %+v, want empty", again)
	}

	t.Run("read", func(t *testing.T) {
		got, err := app.W.OpenedFilesSvc.Read(bridge.OpenedFilesReadArgs{Path: loose})
		if err != nil || got.Kind != "found" || got.Language != "json" || got.Text != "{\"k\": 1}\n" {
			t.Fatalf("Read = %+v, %v, want found json", got, err)
		}
		app.Contract(t, "opened-files", "OpenedFilesService.Read", got)
		for _, bad := range []string{"notes/b.json", txt} {
			if _, err := app.W.OpenedFilesSvc.Read(bridge.OpenedFilesReadArgs{Path: bad}); err == nil {
				t.Fatalf("Read(%q) succeeded, want refusal", bad)
			}
		}
	})

	t.Run("symlink into a repo resolves to the repo", func(t *testing.T) {
		link := filepath.Join(notes, "link.go")
		if err := os.Symlink(filepath.Join(repo.Dir, "src", "a.go"), link); err != nil {
			t.Fatal(err)
		}
		app.W.OpenedFiles.Open([]string{link})
		if len(app.WindowMgr.OpenedKeyed) != 2 {
			t.Fatalf("keyed windows = %d, want 2", len(app.WindowMgr.OpenedKeyed))
		}
		got := pendingFor(t, app, app.WindowMgr.OpenedKeyed[1])
		if len(got) != 1 || got[0].RepoID != rec.ID || got[0].RelPath != "src/a.go" {
			t.Fatalf("targets = %+v, want repo src/a.go", got)
		}
	})

	t.Run("nothing qualifying opens no window", func(t *testing.T) {
		app.W.OpenedFiles.Open([]string{txt})
		if len(app.WindowMgr.OpenedKeyed) != 2 {
			t.Fatalf("keyed windows = %d, want 2", len(app.WindowMgr.OpenedKeyed))
		}
	})

	t.Run("forget before pull clears the entry", func(t *testing.T) {
		app.W.OpenedFiles.Open([]string{loose})
		k := app.WindowMgr.OpenedKeyed[len(app.WindowMgr.OpenedKeyed)-1]
		app.W.OpenedFiles.Forget(k)
		if got := pendingFor(t, app, k); len(got) != 0 {
			t.Fatalf("Pending after Forget = %+v, want empty", got)
		}
	})
}
