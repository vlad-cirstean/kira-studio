// Package gitsession owns SPEC §6's session model: Registry (a refcounted, per-repo set of shared
// RepoEntry state) and Conn (one accepted connection's private holds and event delivery). It
// imports gitclient, gitpreflight, gitreview and stdlib only — no bridge, no rpcstream, no gitsock
// — so it stays a domain package internal/layering_test.go's auto-enumerated check covers without
// an exemption. G11 adds Registry.Review (a *gitreview.Store, D3): the one place this package
// reaches beyond gitclient's own family, and still nowhere near bridge.
package gitsession

import (
	"context"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// defaultLingerFor is upstream's HIDDEN_EVICT_MS, applied at refcount zero (D12): the duration and
// intent of SPEC §6's "hidden-eviction grace period" carried over, even though the host-visibility
// mechanism it originally named (setUiVisible) has no wire method here to trigger it (F14).
const defaultLingerFor = 5 * time.Minute

// slot is one entry's bookkeeping the Registry itself owns — refs and lingerTimer are
// deliberately not on RepoEntry (D13: "owned by Registry"), since a RepoEntry has no business
// tracking its own reference count.
type slot struct {
	entry       *RepoEntry
	refs        int
	lingerTimer *time.Timer
}

// Registry is the per-app set of open repositories, keyed by RepoID (the absolute git dir, F16),
// with real refcounted teardown — replacing gitclient.Registry's unconditional evict-on-close
// (F7): the same repository opened from two connections now stays alive until both release it.
type Registry struct {
	runner gitclient.Runner
	// NewWatcher is the watcher construction seam (D12/§3.5): defaulted to gitclient.NewRepoWatcher,
	// overridable so registry_test.go/conn_test.go/subscriber_test.go, and gitsock's own
	// integration test across the package boundary, need no filesystem or real git — the real
	// watcher is proven in gitclient/watcher_test.go and end to end in gitsock's integration tests.
	// Exported so a test can inject a counting fake without a production-only accessor (§3.9).
	NewWatcher func(gitclient.RepoSummary) (Watcher, error)
	// LingerFor is the refcount-zero grace period (D12), a field rather than a constant so tests
	// can shrink it to a few milliseconds. Zero means "use defaultLingerFor" — set by NewRegistry.
	LingerFor time.Duration
	// Settings is G7 D16's server-owned settings accessor: the protected-branch pattern list and
	// the auto-fetch interval, read fresh on every push pre-flight/run and every auto-fetch tick —
	// never cached, since a stale protected-branch list is a safety bug. A plain func rather than
	// an interface so this package keeps importing only gitclient and stdlib (main.go supplies the
	// real one, backed by storage/repos.SettingsRepo; tests set it directly, the same seam
	// NewWatcher/LingerFor already are). Defaulted to "no protected branches, auto-fetch off".
	//
	// G18 D15: widened from two return values to three — gitPath is the same closure-injected,
	// read-fresh-never-cached leaf of the same server-owned settings table, threaded through so
	// gitrpc's Discovery.Status call sites can resolve a real configured path instead of a
	// hardcoded "".
	Settings func() (protectedBranches []string, autoFetchMinutes int, gitPath string)

	// RepoSettingsGet/RepoSettingsSet are G18 D8's own closures: the seven per-repo display
	// settings (D3), backed by storage/repos.GitRepoSettingsRepo — the same "plain func, not an
	// interface" seam Settings above already is, for the same reason (this package stays under
	// gitclient/gitreview/stdlib only). D14's log.level sentinel substitution happens entirely
	// inside GitRepoSettingsRepo itself — neither this Registry nor anything above it needs to
	// know the substitution exists. Defaulted to the schema's own defaults, read-only, writing
	// nowhere — a Registry a test constructs by hand (rather than via NewRegistry) still answers
	// something sane rather than nil-panicking.
	RepoSettingsGet func(repoID string) (model.GitRepoSettings, error)
	RepoSettingsSet func(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error)

	// Review is G11 D3's own seam: review.db's whole surface, defaulted below to a Store over
	// gitreview.DefaultPath(). Construction is free (the file opens lazily, on the first review
	// request) — an instance that never serves one never creates review.db and never starts its
	// reaper. Tests override this with a Store under t.TempDir(), the same seam NewWatcher already
	// is (§0.4's "every review.db a test opens lives under t.TempDir()").
	Review *gitreview.Store

	// Gh is G24 D1's own single GitHub surface — shared off the Registry exactly like Review above
	// (one process-wide *ghclient.Client, never one per repository); each RepoEntry gets its own
	// *ghState (the caches/breaker), but every entry shares this one Client. Defaulted below to a
	// real Discovery+Runner pair; tests override it with a Client built over a fake/counting
	// ghclient.Runner (F13: gh is never actually installed in this container).
	Gh *ghclient.Client

	mu      sync.Mutex
	entries map[string]*slot
}

// NewRegistry constructs a Registry over runner, with the real fsnotify-backed watcher and
// defaultLingerFor.
func NewRegistry(runner gitclient.Runner) *Registry {
	return &Registry{
		runner:     runner,
		NewWatcher: func(s gitclient.RepoSummary) (Watcher, error) { return gitclient.NewRepoWatcher(s) },
		LingerFor:  defaultLingerFor,
		Settings:   func() ([]string, int, string) { return nil, 0, "" },
		RepoSettingsGet: func(string) (model.GitRepoSettings, error) {
			return model.DefaultGitRepoSettings(), nil
		},
		RepoSettingsSet: func(string, model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
			return model.DefaultGitRepoSettings(), nil
		},
		Review: gitreview.NewStore(gitreview.DefaultPath()),
		Gh: ghclient.NewClient(
			ghclient.NewDiscovery(ghclient.NewPlatformLocator(), ghclient.NewExecRunner(), ghclient.NewRealClock()),
			ghclient.NewExecRunner(),
		),
		entries: make(map[string]*slot),
	}
}

// Acquire identifies path (outside any lock — Identify spawns several rev-parse processes, and
// holding a registry-wide lock across them would serialise every window's repo.open, D12 step 1),
// then either joins an already-open entry (cancelling its linger, if one is armed) or constructs a
// new one — watcher included — under the lock. The returned release is idempotent; call it exactly
// once per successful Acquire.
func (reg *Registry) Acquire(ctx context.Context, gitPath, path string) (*RepoEntry, func(), error) {
	summary, err := gitclient.Identify(ctx, reg.runner, gitPath, path)
	if err != nil {
		return nil, nil, err
	}

	reg.mu.Lock()
	defer reg.mu.Unlock()

	if sl, ok := reg.entries[summary.RepoID]; ok {
		if sl.lingerTimer != nil {
			sl.lingerTimer.Stop()
			sl.lingerTimer = nil
		}
		sl.refs++
		return sl.entry, reg.releaseFunc(summary.RepoID), nil
	}

	w, err := reg.NewWatcher(summary)
	if err != nil {
		return nil, nil, err
	}
	repo := gitclient.NewRepo(summary, reg.runner, gitPath)
	entry := newRepoEntry(summary, repo, w, reg.Settings, reg.RepoSettingsGet, reg.Review, reg.Gh)
	reg.entries[summary.RepoID] = &slot{entry: entry, refs: 1}
	return entry, reg.releaseFunc(summary.RepoID), nil
}

func (reg *Registry) releaseFunc(repoID string) func() {
	var once sync.Once
	return func() {
		once.Do(func() { reg.release(repoID) })
	}
}

// release drops one ref; at zero it closes the entry's cat-file session (D13a) and arms the linger
// timer rather than tearing down immediately (D12 step 3) — the watcher and every cache keep
// running through the window, which is the point: a reload that reopens within seconds reuses the
// entry and its caches stay valid rather than silently stale. The cat-file pair is different: it
// holds two OS processes for a session nobody is using, its answers are content-addressed so
// restarting it costs nothing, and CatFile() already restarts it lazily on the next use exactly as
// it does on first use — so closing it here is pure savings with no correctness cost.
func (reg *Registry) release(repoID string) {
	reg.mu.Lock()
	defer reg.mu.Unlock()

	sl, ok := reg.entries[repoID]
	if !ok {
		return
	}
	sl.refs--
	if sl.refs > 0 {
		return
	}
	sl.entry.closeCatFile()
	lingerFor := reg.LingerFor
	if lingerFor <= 0 {
		lingerFor = defaultLingerFor
	}
	sl.lingerTimer = time.AfterFunc(lingerFor, func() { reg.expire(repoID) })
}

// expire tears an entry down once its linger window has elapsed — re-checking refs == 0 under the
// lock first (D12 step 4), since a re-acquire between the timer firing and this callback taking the
// lock must win.
func (reg *Registry) expire(repoID string) {
	reg.mu.Lock()
	sl, ok := reg.entries[repoID]
	if !ok || sl.refs != 0 {
		reg.mu.Unlock()
		return
	}
	delete(reg.entries, repoID)
	reg.mu.Unlock()

	sl.entry.teardown()
}

// Close tears down every entry immediately, linger notwithstanding — for gitsock.Server.Close(), a
// real shutdown rather than a viewer going away for a moment (D12 step 5). Also closes Review
// (G11 D3) — idempotent and safe even when review.db was never opened.
func (reg *Registry) Close() {
	reg.mu.Lock()
	entries := reg.entries
	reg.entries = make(map[string]*slot)
	reg.mu.Unlock()

	for _, sl := range entries {
		if sl.lingerTimer != nil {
			sl.lingerTimer.Stop()
		}
		sl.entry.teardown()
	}

	if reg.Review != nil {
		_ = reg.Review.Close()
	}
}
