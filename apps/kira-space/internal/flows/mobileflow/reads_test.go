package mobileflow_test

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func normalize(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func hasKey(v any, key string) bool {
	switch x := v.(type) {
	case map[string]any:
		if _, ok := x[key]; ok {
			return true
		}
		for _, c := range x {
			if hasKey(c, key) {
				return true
			}
		}
	case []any:
		for _, c := range x {
			if hasKey(c, key) {
				return true
			}
		}
	}
	return false
}

func dropKey(v any, key string) {
	switch x := v.(type) {
	case map[string]any:
		delete(x, key)
		for _, c := range x {
			dropKey(c, key)
		}
	case []any:
		for _, c := range x {
			dropKey(c, key)
		}
	}
}

// pairedPhone starts the server, enables agent input globally and pairs one phone.
func pairedPhone(t *testing.T, f *fixture) (*phone, string) {
	t.Helper()
	st := serve(t, f.app)
	p := newPhone(t, st.AppURL)
	return p, p.pair(f.app, "Ana's phone")
}

func TestPhoneReadsRealAde(t *testing.T) {
	f := newFixture(t)
	app := f.app
	if _, err := app.W.AdeTask.AddBacklogItem(ctx, adewire.AddBacklogItemArgs{Text: "Write the docs"}); err != nil {
		t.Fatal(err)
	}
	f.startSession(t)
	p, _ := pairedPhone(t, f)

	check := func(path string, bound any, stripCwd ...bool) {
		t.Helper()
		r := p.get(path)
		if r.Status != http.StatusOK {
			t.Fatalf("GET %s = %d %s", path, r.Status, r.Body)
		}
		var got any
		r.json(t, &got)
		want := normalize(t, bound)
		if len(stripCwd) > 0 {
			dropKey(want, "cwd")
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("GET %s differs from the bound service\n got: %s\nwant: %s", path, r.Body, mustJSON(want))
		}
		if hasKey(got, "cwd") {
			t.Errorf("GET %s leaks a cwd: %s", path, r.Body)
		}
	}

	board, err := app.W.AdeTask.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Branches) != 1 || board.Branches[0].Worktree == "" {
		t.Fatalf("bound board has no worktree branch: %+v", board.Branches)
	}
	check("/api/ade/board", board)
	backlog, _ := app.W.AdeTask.Backlog(ctx)
	check("/api/ade/backlog", backlog)
	app.Contract(t, "mobile-board", "http:GET /api/ade/backlog", p.get("/api/ade/backlog").raw(t), flowharness.Mask("addedAt"))
	workflows, _ := app.W.AdeTask.Workflows(ctx)
	check("/api/ade/workflows", workflows)
	sessions, _ := app.W.AdeTask.Sessions(ctx)
	check("/api/ade/sessions", sessions, true)
	t.Run("sessions carry no cwd", func(t *testing.T) {
		var got any
		p.get("/api/ade/sessions").json(t, &got)
		if hasKey(got, "cwd") {
			t.Fatalf("GET /api/ade/sessions leaks a cwd: %s", mustJSON(got))
		}
	})
	log, err := app.W.AdeTask.ReadLog(ctx, adewire.ReadLogArgs{Kind: "run", ID: f.runID})
	if err != nil || len(log.Chunks) == 0 {
		t.Fatalf("bound run log = %+v, %v, want chunks of the finished run", log, err)
	}
	check("/api/ade/log?kind=run&id="+f.runID, log)

	repos, _ := app.W.AdeTask.Repos(ctx)
	var names []map[string]any
	for _, r := range repos.Repos {
		names = append(names, map[string]any{"codeRepoId": r.CodeRepoID, "name": r.Name, "nickname": r.Nickname})
	}
	check("/api/ade/repos", map[string]any{"repos": names})
	if len(names) != 1 {
		t.Fatalf("repos = %v, want the one imported repo", names)
	}

	// The agent session list drops the working directory the desktop list carries.
	live := normalize(t, app.W.Terminal.AgentSessions())
	if !hasKey(live, "cwd") && !hasKey(live, "Cwd") {
		t.Fatalf("desktop agent sessions %v carry no cwd to strip", live)
	}
	r := p.get("/api/agent/sessions")
	if r.Status != http.StatusOK {
		t.Fatalf("GET /api/agent/sessions = %d", r.Status)
	}
	var got any
	r.json(t, &got)
	if hasKey(got, "cwd") || hasKey(got, "Cwd") {
		t.Fatalf("phone agent sessions leak a cwd: %s", r.Body)
	}
	dropKey(live, "cwd")
	dropKey(live, "Cwd")
	if !reflect.DeepEqual(got, live) {
		t.Errorf("phone agent sessions %s differ from desktop %s", r.Body, mustJSON(live))
	}
}

func mustJSON(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}
