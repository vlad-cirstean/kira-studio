package gitsock

import (
	"encoding/json"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
)

// recvRepoSettingsChanged reads one frame and requires it to be an 'evt' frame for
// repoSettings.changed, decoding its payload — the same shape recvEvent already gives
// repo.changed, restated here since that helper's own return type is repo.changed-specific.
func recvRepoSettingsChanged(c *testClient) gitrpc.RepoSettingsChangedPayload {
	c.t.Helper()
	raw, err := readFrame(c.r)
	if err != nil {
		c.t.Fatalf("read event: %v", err)
	}
	var env wireEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		c.t.Fatalf("unmarshal event: %v\n%s", err, raw)
	}
	if env.Body.T != "evt" || env.Body.Method != "repoSettings.changed" {
		c.t.Fatalf("frame = %+v, want an evt frame for repoSettings.changed", env.Body)
	}
	var payload gitrpc.RepoSettingsChangedPayload
	if err := json.Unmarshal(env.Body.Payload, &payload); err != nil {
		c.t.Fatalf("unmarshal payload: %v\n%s", err, env.Body.Payload)
	}
	return payload
}

// TestIntegration_RepoSettingsLogLevelCollapsesAcrossRealRepos is G18 §3.5/§3.18's own end-to-end
// proof, over the real socket and the real per-test SQLite database (not a fake): repoSettings.set
// for kiraVersion.log.level on repo A is visible via repoSettings.get on repo B (D14's own
// cross-repo sentinel collapse), and repoSettings.changed reaches a connection that only ever
// opened the OTHER repo (D7's fan-out, D14's instance-wide field together).
func TestIntegration_RepoSettingsLogLevelCollapsesAcrossRealRepos(t *testing.T) {
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

	// Set log.level via A's own repoSettings.set. requestIgnoringEvents, not requestOK: A is
	// also a subscriber of its own repoSettings.changed (D7 fans out to every connection, the
	// requester included), so A's own event can legitimately arrive interleaved with its
	// request's own response — the same hazard remoteRunOK's own doc comment names for
	// remote.progress.
	setResp := requestIgnoringEvents(t, clientA, "repoSettings.set", map[string]any{
		"repoId": repoIDA,
		"patch":  map[string]any{"kiraVersion.log.level": "debug"},
	})
	var setResult gitrpc.RepoSettingsSnapshot
	if err := json.Unmarshal(setResp.Result, &setResult); err != nil {
		t.Fatalf("unmarshal repoSettings.set result: %v", err)
	}
	if setResult.LogLevel != "debug" {
		t.Fatalf("repoSettings.set(a) result.LogLevel = %q, want %q", setResult.LogLevel, "debug")
	}

	// B, even though it never opened (or heard of) repo A, must have received
	// repoSettings.changed for A's own write too (D7's fan-out) — drained here, before B's own
	// request below, since a plain request() (unlike remote.run's own requestIgnoringEvents) reads
	// exactly one frame and requires it to be the matching response; a queued event ahead of it
	// would otherwise be mistaken for one (the same race remote_test.go's own "a fresh connection
	// may still carry queued repo.changed events" comment names for a different event).
	changed := recvRepoSettingsChanged(clientB)
	if changed.RepoID != repoIDA || changed.Settings.LogLevel != "debug" {
		t.Fatalf("repoSettings.changed on B = %+v, want repoId=%s logLevel=debug", changed, repoIDA)
	}

	// B, which has never touched log.level itself, must read it back the same way — real storage,
	// not a fake, proving D14's sentinel collapse actually happens end to end.
	getResp := requestOK(t, clientB, "repoSettings.get", map[string]any{"repoId": repoIDB})
	var getResult gitrpc.RepoSettingsSnapshot
	if err := json.Unmarshal(getResp.Result, &getResult); err != nil {
		t.Fatalf("unmarshal repoSettings.get result: %v", err)
	}
	if getResult.LogLevel != "debug" {
		t.Fatalf("repoSettings.get(b).LogLevel = %q, want %q (sentinel collapse across real repos)", getResult.LogLevel, "debug")
	}
}
