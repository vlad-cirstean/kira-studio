package repoflow_test

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func TestHideRepo(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("proj")
	r.Commit("init", map[string]string{"a.txt": "a\n"})
	rec := importVia(t, app, r.Dir)
	if rec.Hidden {
		t.Fatalf("fresh import %+v is hidden", rec)
	}

	mark := app.Events.Mark()
	hidden, err := app.W.CodeWorkspace.SetRepoHidden(bridge.CodeWorkspaceSetHiddenArgs{ID: rec.ID, Hidden: true})
	if err != nil || !hidden.Hidden || hidden.ID != rec.ID {
		t.Fatalf("SetRepoHidden = %+v, %v, want hidden", hidden, err)
	}
	app.Contract(t, "repos-hidden", "CodeWorkspaceService.SetRepoHidden", hidden, flowharness.Mask("createdAt"))
	app.Events.WaitAfter(t, mark, adewire.ChannelRepos, nil, 5*time.Second)
	list, err := app.W.CodeWorkspace.ListRepos()
	if err != nil || len(list) != 1 || !list[0].Hidden {
		t.Fatalf("ListRepos = %+v, %v, want one hidden row", list, err)
	}

	app.Restart()
	if list, err = app.W.CodeWorkspace.ListRepos(); err != nil || len(list) != 1 || !list[0].Hidden {
		t.Fatalf("after restart ListRepos = %+v, %v, want the flag kept", list, err)
	}

	t.Run("empty id refused", func(t *testing.T) {
		_, err := app.W.CodeWorkspace.SetRepoHidden(bridge.CodeWorkspaceSetHiddenArgs{Hidden: true})
		if errCode(err) != "E_BAD_REQUEST" {
			t.Fatalf("err = %v, want E_BAD_REQUEST", err)
		}
	})

	t.Run("importing a hidden repo again shows it", func(t *testing.T) {
		again, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: r.Dir})
		if err != nil || again.ID != rec.ID || again.Hidden {
			t.Fatalf("re-import = %+v, %v, want the same id, visible", again, err)
		}
	})

	t.Run("importing a visible repo again is refused", func(t *testing.T) {
		_, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: r.Dir})
		if errCode(err) != "E_ALREADY_IMPORTED" {
			t.Fatalf("err = %v, want E_ALREADY_IMPORTED", err)
		}
	})
}
