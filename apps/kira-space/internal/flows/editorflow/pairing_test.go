package editorflow_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

func TestEditorPairsAndReadsRepo(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewHistory("hist", flowharness.HistorySpec{Commits: 30, Branches: 3})
	mark := app.Events.Mark()

	c, token := pair(t, app, "editor-1", "VS Code")
	if token == "" {
		t.Fatal("no session token issued")
	}
	app.Events.WaitAfter(t, mark, bridge.ChannelGitPairing, nil, waitFor)

	if snap := app.W.GitClients.PendingPairing(); snap.Pending != nil {
		t.Fatalf("pairing still pending after approval: %+v", snap)
	}
	clients, err := app.W.GitClients.List()
	if err != nil || len(clients) != 1 || clients[0].ID != "editor-1" {
		t.Fatalf("List = %+v, %v", clients, err)
	}

	var open gitrpc.RepoOpenResult
	if code := c.call("repo.open", gitrpc.RepoOpenParams{Path: r.Dir}, &open); code != "" {
		t.Fatalf("repo.open: %s", code)
	}
	if open.Kind != "ok" || open.Repo == nil {
		t.Fatalf("repo.open = %+v", open)
	}
	chunks := c.stream("graph.stream", map[string]any{"repoId": open.Repo.RepoID})
	if len(chunks) == 0 {
		t.Fatal("graph.stream sent no chunks")
	}
	var meta flowharness.GraphMeta
	if err := json.Unmarshal(chunks[len(chunks)-1], &meta); err != nil {
		t.Fatal(err)
	}
	if want := len(r.RevList("--all")); meta.To != want || !meta.Exhausted {
		t.Fatalf("last chunk to=%d exhausted=%v, want %d rows exhausted", meta.To, meta.Exhausted, want)
	}

	r.Commit("external", map[string]string{"ext.txt": "x\n"})
	if err := until(func() bool { return len(c.events("repo.changed")) > 0 }); err != nil {
		t.Fatal("no repo.changed event after an external commit")
	}
}

func TestEditorDenyRevokeRepair(t *testing.T) {
	app := flowharness.New(t)

	t.Run("deny ends the handshake", func(t *testing.T) {
		c := dial(t, app)
		c.hello("editor-deny", "VS Code", nil)
		kind, _ := c.handshake(func(reqID string) {
			go func() {
				if res, err := app.W.GitClients.Deny(bridge.GitClientsIDArgs{ID: reqID}); err != nil || res.Result != "resolved" {
					t.Errorf("Deny = %+v, %v", res, err)
				}
			}()
		})
		if kind != "pairingDenied" {
			t.Fatalf("handshake ended %q, want pairingDenied", kind)
		}
		if clients, _ := app.W.GitClients.List(); len(clients) != 0 {
			t.Fatalf("denied client stored: %+v", clients)
		}
	})

	var token string
	t.Run("revoke drops the connection and the token", func(t *testing.T) {
		var c *editor
		c, token = pair(t, app, "editor-2", "VS Code")
		mark := app.Events.Mark()
		if err := app.W.GitClients.Revoke(bridge.GitClientsIDArgs{ID: "editor-2"}); err != nil {
			t.Fatal(err)
		}
		app.Events.WaitAfter(t, mark, bridge.ChannelGitClientsChanged, nil, waitFor)
		if err := until(c.dropped); err != nil {
			t.Fatal("connection still up after Revoke")
		}
		stale := dial(t, app)
		stale.hello("editor-2", "VS Code", &token)
		if kind, _ := stale.handshake(nil); kind != "tokenRejected" {
			t.Fatalf("revoked token handshake = %q, want tokenRejected", kind)
		}
	})

	t.Run("re-pair works and the stored token survives a restart", func(t *testing.T) {
		c, tok := pair(t, app, "editor-2", "VS Code")
		var open gitrpc.RepoOpenResult
		r := app.NewRepo("again")
		r.Commit("init", map[string]string{"a": "a\n"})
		if code := c.call("repo.open", gitrpc.RepoOpenParams{Path: r.Dir}, &open); code != "" || open.Kind != "ok" {
			t.Fatalf("repo.open = %+v code %q", open, code)
		}
		app.Restart()
		if err := until(c.dropped); err != nil {
			t.Fatal("connection survived restart")
		}
		back := dial(t, app)
		back.hello("editor-2", "VS Code", &tok)
		prompted := false
		kind, _ := back.handshake(func(string) { prompted = true })
		if kind != "ready" || prompted {
			t.Fatalf("token reconnect kind %q prompted %v, want ready without prompt", kind, prompted)
		}
		if code := back.call("repo.open", gitrpc.RepoOpenParams{Path: r.Dir}, &open); code != "" || open.Kind != "ok" {
			t.Fatalf("repo.open after reconnect = %+v code %q", open, code)
		}
	})
}

func TestEditorRefusesSpaceWrites(t *testing.T) {
	app := flowharness.New(t)
	r := app.NewRepo("guarded")
	r.Commit("init", map[string]string{"a": "a\n"})
	c, _ := pair(t, app, "editor-3", "VS Code")
	var open gitrpc.RepoOpenResult
	if code := c.call("repo.open", gitrpc.RepoOpenParams{Path: r.Dir}, &open); code != "" || open.Repo == nil {
		t.Fatalf("repo.open = %+v code %q", open, code)
	}
	id := open.Repo.RepoID

	for _, tc := range []struct {
		method string
		params any
	}{
		{"repoSettings.set", gitrpc.RepoSettingsSetParams{RepoID: id, Patch: gitrpc.RepoSettingsPatchWire{}}},
		{"credential.provide", map[string]any{"requestId": "x", "username": "u", "secret": "s"}},
	} {
		if code := c.call(tc.method, tc.params, nil); code != "E_READ_ONLY" {
			t.Errorf("%s over git.sock = %q, want E_READ_ONLY", tc.method, code)
		}
	}
	// A socket client cannot set the prepare script (repoSettings.set is refused above), so
	// worktree.prepare finds none and spawns nothing (P172).
	dest := r.Dir + "-prepared"
	var prep map[string]any
	code := c.call("worktree.prepare", gitrpc.WorktreePrepareParams{RepoID: id, Path: dest, ScriptSha256: "deadbeef"}, &prep)
	if errInfo, _ := prep["error"].(map[string]any); code != "" || prep["ok"] != false || errInfo["kind"] != "NotConfigured" {
		t.Errorf("worktree.prepare = code %q %v, want ok=false NotConfigured", code, prep)
	}
	if _, err := os.Stat(dest); err == nil {
		t.Error("worktree.prepare created a directory for an unknown script")
	}
	// Reads on the same connection still work.
	if code := c.call("status.get", map[string]any{"repoId": id}, nil); code == "closed" {
		t.Error("connection dropped by refusals")
	}
}
