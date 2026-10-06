package gitsock

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// recvRepoSettingsChanged reads one frame and requires it to be an 'evt' frame for
// repoSettings.changed, decoding its payload — the same shape recvEvent already gives
// repo.changed, restated here since that helper's own return type is repo.changed-specific.
func recvRepoSettingsChanged(c *testClient) gitrpc.RepoSettingsChangedPayload {
	c.t.Helper()
	body := c.nextEvent("repoSettings.changed")
	var payload gitrpc.RepoSettingsChangedPayload
	if err := json.Unmarshal(body.Payload, &payload); err != nil {
		c.t.Fatalf("unmarshal payload: %v\n%s", err, body.Payload)
	}
	return payload
}

// TestIntegration_RepoSettingsWriteFansOutAndIsPerRepo is P72 §9.2's end-to-end proof over the real
// socket and the real per-test SQLite database: an in-process write (Kira Space's own dialog, via
// Router.SetRepoSettings) reaches every connected client as repoSettings.changed, including one
// that only ever opened the OTHER repo (D7's fan-out), and stays scoped to the repo written.
func TestIntegration_RepoSettingsWriteFansOutAndIsPerRepo(t *testing.T) {
	t.Parallel()
	server, sockPath, _, _ := newIntegrationServer(t)

	repoADir := initFixtureRepo(t)
	repoBDir := initFixtureRepo(t)

	clientA := pairAndReady(t, server, sockPath, "settings-a")
	clientB := pairAndReady(t, server, sockPath, "settings-b")
	repoIDA := openRepoOK(t, clientA, repoADir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, repoBDir).Repo.RepoID
	if repoIDA == repoIDB {
		t.Fatalf("repoIDA (%s) == repoIDB (%s), want genuinely distinct repositories", repoIDA, repoIDB)
	}

	scope := "head"
	if err := server.deps.Router.SetRepoSettings(repoIDA, model.GitRepoSettingsPatch{GraphScope: &scope}); err != nil {
		t.Fatalf("SetRepoSettings(a): %v", err)
	}

	for name, c := range map[string]*testClient{"a": clientA, "b": clientB} {
		changed := recvRepoSettingsChanged(c)
		if changed.RepoID != repoIDA || changed.Settings.GraphScope != "head" {
			t.Fatalf("repoSettings.changed on %s = %+v, want repoId=%s graphScope=head", name, changed, repoIDA)
		}
	}

	getResp := requestOK(t, clientB, "repoSettings.get", map[string]any{"repoId": repoIDB})
	var getResult gitrpc.RepoSettingsSnapshot
	if err := json.Unmarshal(getResp.Result, &getResult); err != nil {
		t.Fatalf("unmarshal repoSettings.get result: %v", err)
	}
	if getResult.GraphScope != "all" {
		t.Fatalf("repoSettings.get(b).GraphScope = %q, want %q (the default, unscoped by a's write)", getResult.GraphScope, "all")
	}
}

// P178: repository settings are written in Kira Space only, so a socket client's repoSettings.set
// is refused outright and changes nothing.
func TestIntegration_SocketClientCannotSetRepoSettings(t *testing.T) {
	t.Parallel()
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir := initFixtureRepo(t)
	client := pairAndReady(t, server, sockPath, "settings-refused")
	repoID := openRepoOK(t, client, repoDir).Repo.RepoID

	setResp := client.request("repoSettings.set", map[string]any{
		"repoId": repoID,
		"patch":  map[string]any{"kiraSpace.graph.scope": "head"},
	})
	if setResp.OK == nil || *setResp.OK || setResp.Error == nil || setResp.Error.Code != "E_READ_ONLY" {
		t.Fatalf("repoSettings.set = %+v, want E_READ_ONLY", setResp)
	}

	getResp := requestOK(t, client, "repoSettings.get", map[string]any{"repoId": repoID})
	var got gitrpc.RepoSettingsSnapshot
	if err := json.Unmarshal(getResp.Result, &got); err != nil {
		t.Fatalf("unmarshal repoSettings.get result: %v", err)
	}
	if got.GraphScope != "all" {
		t.Fatalf("GraphScope = %q after a refused write, want the default %q", got.GraphScope, "all")
	}
}

// P172: over a real socket, a paired client cannot store a prepare script, so worktree.prepare
// with any sha spawns nothing.
func TestIntegration_SocketClientCannotStorePrepareScript(t *testing.T) {
	t.Parallel()
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir := initFixtureRepo(t)
	client := pairAndReady(t, server, sockPath, "prepare-refused")
	repoID := openRepoOK(t, client, repoDir).Repo.RepoID

	script := "touch " + filepath.Join(repoDir, "pwned")
	setResp := client.request("repoSettings.set", map[string]any{
		"repoId": repoID,
		"patch":  map[string]any{"kiraSpace.worktree.prepareScript": script},
	})
	if setResp.OK == nil || *setResp.OK || setResp.Error == nil || setResp.Error.Code != "E_READ_ONLY" {
		t.Fatalf("repoSettings.set = %+v, want E_READ_ONLY", setResp)
	}

	sum := sha256.Sum256([]byte(script))
	prepResp := requestOK(t, client, "worktree.prepare", map[string]any{
		"repoId": repoID, "path": repoDir, "scriptSha256": hex.EncodeToString(sum[:]),
	})
	var result struct {
		OK    bool `json:"ok"`
		Error *struct {
			Kind string `json:"kind"`
		} `json:"error"`
	}
	if err := json.Unmarshal(prepResp.Result, &result); err != nil {
		t.Fatalf("unmarshal worktree.prepare result: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "NotConfigured" {
		t.Fatalf("worktree.prepare = %+v, want NotConfigured", result)
	}
	if _, err := os.Stat(filepath.Join(repoDir, "pwned")); err == nil {
		t.Fatal("script ran")
	}
}
