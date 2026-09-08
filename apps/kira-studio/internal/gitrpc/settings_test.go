package gitrpc

import (
	"context"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// fakeRepoSettingsStore is a minimal, in-memory stand-in for storage/repos.GitRepoSettingsRepo —
// it reproduces D14's own sentinel substitution (the one behaviour these tests actually need to
// exercise) without opening a real database, the same "closures over a plain map" shape
// registry_test.go's own fakes already use elsewhere in this chapter.
type fakeRepoSettingsStore struct {
	rows map[string]model.GitRepoSettings
}

func newFakeRepoSettingsStore() *fakeRepoSettingsStore {
	return &fakeRepoSettingsStore{rows: map[string]model.GitRepoSettings{}}
}

func (f *fakeRepoSettingsStore) get(repoID string) (model.GitRepoSettings, error) {
	if s, ok := f.rows[repoID]; ok {
		return s, nil
	}
	return model.DefaultGitRepoSettings(), nil
}

func (f *fakeRepoSettingsStore) set(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
	// D14: logLevel collapses onto the sentinel "" repo id regardless of the caller's own repoID —
	// the same substitution GitRepoSettingsRepo itself makes, reproduced here so this test proves
	// the RPC layer is honest about what the storage layer already guarantees, not merely that a
	// fake with no such behaviour happens to also pass.
	current, err := f.get(repoID)
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	if patch.GraphPageSize != nil {
		current.GraphPageSize = *patch.GraphPageSize
	}
	if patch.GraphScope != nil {
		current.GraphScope = *patch.GraphScope
	}
	if patch.StashShowInGraph != nil {
		current.StashShowInGraph = *patch.StashShowInGraph
	}
	if patch.StashIncludeUntracked != nil {
		current.StashIncludeUntracked = *patch.StashIncludeUntracked
	}
	if patch.ReviewBaseCandidates != nil {
		current.ReviewBaseCandidates = *patch.ReviewBaseCandidates
	}
	if patch.PullStrategy != nil {
		current.PullStrategy = *patch.PullStrategy
	}
	f.rows[repoID] = current

	if patch.LogLevel != nil {
		sentinel, err := f.get("")
		if err != nil {
			return model.GitRepoSettings{}, err
		}
		sentinel.LogLevel = *patch.LogLevel
		f.rows[""] = sentinel
	}
	return f.getResolved(repoID)
}

func (f *fakeRepoSettingsStore) getResolved(repoID string) (model.GitRepoSettings, error) {
	s, err := f.get(repoID)
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	sentinel, err := f.get("")
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	s.LogLevel = sentinel.LogLevel
	return s, nil
}

func newTestRouter() (*Router, *gitsession.Registry) {
	store := newFakeRepoSettingsStore()
	reg := gitsession.NewRegistry(nil)
	reg.RepoSettingsGet = store.getResolved
	reg.RepoSettingsSet = func(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
		return store.set(repoID, patch)
	}
	return New(Deps{Registry: reg, ServerVersion: "test"}), reg
}

// TestRepoSettings_GetSetRoundTrip proves repoSettings.get/set thread a real patch through to
// storage and back, including the seven-key snapshot shape (D4).
func TestRepoSettings_GetSetRoundTrip(t *testing.T) {
	router, _ := newTestRouter()
	conn := gitsession.NewConn("conn-1", "client-1", "label", nil)
	t.Cleanup(conn.Close)

	got, err := router.handleRepoSettingsSet(context.Background(), conn, []byte(`{
		"repoId": "/repos/a",
		"patch": {"kiraVersion.pull.strategy": "rebase"}
	}`))
	if err != nil {
		t.Fatalf("repoSettings.set: %v", err)
	}
	snap, ok := got.(RepoSettingsSnapshot)
	if !ok {
		t.Fatalf("repoSettings.set result = %T, want RepoSettingsSnapshot", got)
	}
	if snap.PullStrategy != "rebase" {
		t.Fatalf("PullStrategy = %q, want %q", snap.PullStrategy, "rebase")
	}

	got, err = router.handleRepoSettingsGet(context.Background(), conn, []byte(`{"repoId": "/repos/a"}`))
	if err != nil {
		t.Fatalf("repoSettings.get: %v", err)
	}
	snap, ok = got.(RepoSettingsSnapshot)
	if !ok {
		t.Fatalf("repoSettings.get result = %T, want RepoSettingsSnapshot", got)
	}
	if snap.PullStrategy != "rebase" {
		t.Fatalf("Get after Set: PullStrategy = %q, want %q", snap.PullStrategy, "rebase")
	}
}

// TestRepoSettings_LogLevelCollapsesAcrossRepos is G18 §3.18's own cross-connection regression
// guard for D14, at the RPC layer this time (§3.5 already covers the storage layer directly):
// repoSettings.set for kiraVersion.log.level on repo A must be visible via repoSettings.get on
// repo B.
func TestRepoSettings_LogLevelCollapsesAcrossRepos(t *testing.T) {
	router, _ := newTestRouter()
	conn := gitsession.NewConn("conn-1", "client-1", "label", nil)
	t.Cleanup(conn.Close)

	if _, err := router.handleRepoSettingsSet(context.Background(), conn, []byte(`{
		"repoId": "/repos/a",
		"patch": {"kiraVersion.log.level": "debug"}
	}`)); err != nil {
		t.Fatalf("repoSettings.set(a): %v", err)
	}

	got, err := router.handleRepoSettingsGet(context.Background(), conn, []byte(`{"repoId": "/repos/b"}`))
	if err != nil {
		t.Fatalf("repoSettings.get(b): %v", err)
	}
	snap := got.(RepoSettingsSnapshot)
	if snap.LogLevel != "debug" {
		t.Fatalf("Get(b).LogLevel = %q, want %q (sentinel collapse across repos)", snap.LogLevel, "debug")
	}
}

// TestRepoSettings_ChangedEventReachesEveryConnection is G18 §3.18's own event-fan-out guard: two
// different Conns — even ones that have never opened the repo the write happened on — both
// receive repoSettings.changed, proving D7's live-propagation mechanism fans a sentinel-backed
// change out to every open connection, not just the one that made the request.
func TestRepoSettings_ChangedEventReachesEveryConnection(t *testing.T) {
	router, _ := newTestRouter()

	connA := gitsession.NewConn("conn-a", "client-a", "label-a", nil)
	connB := gitsession.NewConn("conn-b", "client-b", "label-b", nil)
	t.Cleanup(connA.Close)
	t.Cleanup(connB.Close)

	var gotA, gotB []RepoSettingsChangedPayload
	handlersA := router.ForConn(connA)
	router.ForConn(connB) // registers connB's own subscription; its Handlers are unused here.
	connA.Emit = func(method string, payload any) {
		if method == "repoSettings.changed" {
			gotA = append(gotA, payload.(RepoSettingsChangedPayload))
		}
	}
	connB.Emit = func(method string, payload any) {
		if method == "repoSettings.changed" {
			gotB = append(gotB, payload.(RepoSettingsChangedPayload))
		}
	}

	// A sets log.level on repo A; both connections must be told, even though connB never opened
	// (or even heard of) repo A — log.level is instance-wide (D14), and the RPC layer does not
	// try to filter recipients by repoId.
	if _, err := handlersA.Request(context.Background(), "repoSettings.set", []byte(`{
		"repoId": "/repos/a",
		"patch": {"kiraVersion.log.level": "warn"}
	}`)); err != nil {
		t.Fatalf("repoSettings.set via connA: %v", err)
	}

	// The subscriber callback runs synchronously inside notify.Emitter.Emit (notify.go's own doc
	// comment: "calls each callback with the lock released", not asynchronously dispatched), so no
	// polling/sleep is needed here — but a short deadline-bounded check keeps this test honest
	// against a future implementation that DID make it asynchronous, rather than silently passing
	// on an empty slice.
	deadline := time.Now().Add(time.Second)
	for len(gotA) == 0 || len(gotB) == 0 {
		if time.Now().After(deadline) {
			break
		}
	}

	if len(gotA) != 1 || gotA[0].Settings.LogLevel != "warn" {
		t.Fatalf("connA received %v, want exactly one repoSettings.changed with logLevel=warn", gotA)
	}
	if len(gotB) != 1 || gotB[0].Settings.LogLevel != "warn" {
		t.Fatalf("connB received %v, want exactly one repoSettings.changed with logLevel=warn (fanned out even though connB never opened repo A)", gotB)
	}
}

// TestHandleSettingsSetGitPath is G18 D11's own migration-leg guard: settings.setGitPath must
// reach Deps.SetGitPath with the exact value the caller sent — the write path
// storage/repos.SettingsRepo.Set(SettingsPatch{Git: &GitPatch{GitPath: ...}}) itself is proven at
// the storage layer (storage/repos/settings_test.go-equivalent coverage does not exist for this
// leaf specifically, so this is the one place the plumbing is exercised end to end at the RPC
// layer with a fake).
func TestHandleSettingsSetGitPath(t *testing.T) {
	var got string
	var calls int
	router := New(Deps{SetGitPath: func(gitPath string) error {
		got = gitPath
		calls++
		return nil
	}})

	result, err := router.handleSettingsSetGitPath(context.Background(), []byte(`{"gitPath":"/opt/git/bin/git"}`))
	if err != nil {
		t.Fatalf("settings.setGitPath: %v", err)
	}
	if _, ok := result.(struct{}); !ok {
		t.Fatalf("settings.setGitPath result = %T, want struct{}{}", result)
	}
	if calls != 1 || got != "/opt/git/bin/git" {
		t.Fatalf("SetGitPath called %d time(s) with %q, want once with \"/opt/git/bin/git\"", calls, got)
	}
}

// TestHandleSettingsSetGitPath_NotWired proves the nil-Deps.SetGitPath case fails loudly rather
// than silently doing nothing — a Router constructed without this closure wired (a programming
// error, never main.go's own real wiring) must never look like a successful migration.
func TestHandleSettingsSetGitPath_NotWired(t *testing.T) {
	router := New(Deps{})
	if _, err := router.handleSettingsSetGitPath(context.Background(), []byte(`{"gitPath":"/usr/bin/git"}`)); err == nil {
		t.Fatal("settings.setGitPath with no Deps.SetGitPath wired: want an error, got nil")
	}
}
