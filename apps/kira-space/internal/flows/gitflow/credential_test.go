package gitflow_test

import (
	"context"
	"net"
	"net/http"
	"net/http/cgi"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// smartHTTP serves bare over git's own http-backend behind basic auth and counts auth challenges.
func smartHTTP(t *testing.T, root, user, pass string) (url string, challenges *atomic.Int32) {
	t.Helper()
	execPath, err := exec.Command("git", "--exec-path").Output()
	if err != nil {
		t.Fatal(err)
	}
	backend := filepath.Join(strings.TrimSpace(string(execPath)), "git-http-backend")
	h := &cgi.Handler{Path: backend, Root: "/", Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1"}}
	challenges = new(atomic.Int32)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != user || p != pass {
			challenges.Add(1)
			w.Header().Set("WWW-Authenticate", `Basic realm="git"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	})}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })
	return "http://" + ln.Addr().String(), challenges
}

// answer waits for the next pending prompt and answers it, returning the prompt text.
func answer(t *testing.T, app *flowharness.App, secret string) bridge.GitCredentialPrompt {
	t.Helper()
	var prompt bridge.GitCredentialPrompt
	testx.WaitUntil(t, wait, func() bool {
		pending := app.W.GitCredential.Pending()
		if len(pending) == 0 {
			return false
		}
		prompt = pending[0]
		return true
	})
	ok, err := app.W.GitCredential.Provide(bridge.GitCredentialProvideArgs{RequestID: prompt.RequestID, Secret: &secret})
	if err != nil || !ok {
		t.Fatalf("Provide = %v, %v", ok, err)
	}
	return prompt
}

func refreshOnce(app *flowharness.App) <-chan adewire.RefreshResult {
	done := make(chan adewire.RefreshResult, 1)
	go func() {
		res, _ := app.W.AdeTask.Refresh(context.Background(), adewire.RefreshArgs{})
		done <- res
	}()
	return done
}

func TestHTTPRemoteCredentialPrompt(t *testing.T) {
	app := flowharness.New(t)
	seed := app.NewRepo("seed")
	seed.Commit("base", map[string]string{"a.txt": "a\n"})
	bare := app.NewBare("remote")
	bare.PushFrom(seed)
	bare.Git("config", "http.receivepack", "true")
	url, challenges := smartHTTP(t, app.Work, "ana", "s3cret")
	local := bare.Clone(filepath.Join(app.Work, "local"))
	local.Git("remote", "set-url", "origin", url+"/remote.git")
	other := bare.Clone(filepath.Join(app.Work, "other"))
	rec, err := app.W.CodeWorkspace.ImportRepo(context.Background(), bridge.CodeWorkspaceImportArgs{Path: local.Dir})
	if err != nil {
		t.Fatal(err)
	}
	// The board only refreshes repos a task uses.
	if _, err := app.W.AdeTask.CreateTask(context.Background(), adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}}); err != nil {
		t.Fatal(err)
	}
	// Creating the task does not fetch, so nothing has asked for a credential yet.
	if n := len(app.W.GitCredential.Pending()); n != 0 {
		t.Fatalf("%d prompts before any remote op", n)
	}

	// A right answer: user name, then masked password, then the fetch lands.
	newTip := other.Commit("from other", map[string]string{"b.txt": "b\n"})
	other.Git("remote", "set-url", "origin", bare.Dir)
	bare.PushFrom(other)
	done := refreshOnce(app)
	user := answer(t, app, "ana")
	if user.Masked || !strings.Contains(user.Prompt, "Username") || user.Source == "" {
		t.Fatalf("first prompt = %+v, want an unmasked user name prompt", user)
	}
	pw := answer(t, app, "s3cret")
	if !pw.Masked || !strings.Contains(pw.Prompt, "Password") {
		t.Fatalf("second prompt = %+v, want a masked password prompt", pw)
	}
	if res := <-done; len(res.Repos) != 1 || res.Repos[0].Error != nil {
		t.Fatalf("Refresh with the right password = %+v", res)
	}
	if got := local.Git("rev-parse", "origin/main"); got != newTip {
		t.Fatalf("origin/main = %s, want the fetched %s", got, newTip)
	}
	if left := app.W.GitCredential.Pending(); len(left) != 0 {
		t.Fatalf("prompts left after an answered fetch: %+v", left)
	}
	if ok, err := app.W.GitCredential.Provide(bridge.GitCredentialProvideArgs{RequestID: pw.RequestID}); err != nil || ok {
		t.Fatalf("a stale answer = %v, %v, want false and no error", ok, err)
	}
	if _, err := app.W.GitCredential.Provide(bridge.GitCredentialProvideArgs{}); err == nil {
		t.Fatal("Provide without a request id succeeded")
	}

	// A wrong password: the same two prompts, one classified failure, no prompt loop.
	other.Commit("again", map[string]string{"c.txt": "c\n"})
	bare.PushFrom(other)
	before := challenges.Load()
	done = refreshOnce(app)
	answer(t, app, "ana")
	answer(t, app, "wrong")
	res := <-done
	if len(res.Repos) != 1 || res.Repos[0].Error == nil {
		t.Fatalf("Refresh with a wrong password = %+v, want an error", res)
	}
	msg := res.Repos[0].Error
	if strings.Contains(msg.Message, "exec") || strings.Contains(msg.Message, "exit status") {
		t.Fatalf("raw process error reached the board: %+v", msg)
	}
	if left := app.W.GitCredential.Pending(); len(left) != 0 {
		t.Fatalf("a failed login left prompts queued: %+v", left)
	}
	if got := challenges.Load() - before; got > 3 {
		t.Fatalf("server challenged %d times for one failed fetch, want a bounded retry", got)
	}

	// Dismissing the prompt (nil secret) ends the op without a hang.
	done = refreshOnce(app)
	testx.WaitUntil(t, wait, func() bool { return len(app.W.GitCredential.Pending()) > 0 })
	req := app.W.GitCredential.Pending()[0]
	if ok, err := app.W.GitCredential.Provide(bridge.GitCredentialProvideArgs{RequestID: req.RequestID}); err != nil || !ok {
		t.Fatalf("dismiss = %v, %v", ok, err)
	}
	if res := <-done; len(res.Repos) != 1 || res.Repos[0].Error == nil {
		t.Fatalf("Refresh after a dismissed prompt = %+v, want an error", res)
	}
}
