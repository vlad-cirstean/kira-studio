package repomap

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// RepoSpec is everything Attach needs to serve one more repository — repomap.Server's own D1
// (one server, one port, one token, N attached repositories) starting point.
type RepoSpec struct {
	// Key is the client-facing name a tool call passes as `repo` (Server.pick) — required, unique
	// per Server (case-insensitively).
	Key string
	// RepoID is gitclient.Identify's own identity — the same key codeindex/codegraph are keyed by.
	RepoID string
	// Root is the repository's worktree root.
	Root string
	// GitPath is the resolved git executable; "" lets gitclient discover it from PATH.
	GitPath string
	Runner  gitclient.Runner
}

// RepoInfo is Attach/AttachDir/Repos' own projection of one attached repository's state.
type RepoInfo struct {
	Key, RepoID, Root string
	Ready             bool   // the initial sync has finished
	Degraded          string // idx.SyncState().LastErr, "" when healthy
	// Queued is true while this repository is waiting on initialSyncSem's own slot, after its
	// flock wait has already finished but before any real Sync work has started (Group 5b) — a
	// !Ready repository with Queued false is actively syncing, not merely waiting its turn.
	Queued bool
}

// attachFastPathLocked answers Attach's two "nothing to build" outcomes — this exact repository
// already attached (Attach's own idempotency) or a key collision — under a read lock alone, without
// building a new instance or touching disk. done is false when neither applies, meaning Attach must
// actually build one (outside the lock, 3b below).
func (s *Server) attachFastPathLocked(spec RepoSpec) (info RepoInfo, done bool, err error) {
	s.reposMu.RLock()
	defer s.reposMu.RUnlock()
	if existing, ok := s.repos[spec.Key]; ok {
		if existing.repoID == spec.RepoID && existing.root == spec.Root {
			return existing.info(), true, nil
		}
		return RepoInfo{}, true, fmt.Errorf("repomap: attach: key %q is already attached to a different repository", spec.Key)
	}
	lower := strings.ToLower(spec.Key)
	for k := range s.repos {
		if strings.ToLower(k) == lower {
			return RepoInfo{}, true, fmt.Errorf("repomap: attach: key %q collides (case-insensitively) with already-attached %q", spec.Key, k)
		}
	}
	return RepoInfo{}, false, nil
}

// Attach registers spec as a newly-servable repository, starting its initial Sync in the background
// and its filesystem watcher synchronously — mirroring the sequence a lone Server used to run at
// construction, now runnable any number of times against one already-serving Server. Idempotent:
// attaching a key whose RepoID+Root are unchanged returns the existing instance's RepoInfo and does
// nothing else. Returns as soon as the instance is registered; never waits on the sync.
//
// 3b (P68 review): codeindex.Open/codegraph.New/idx.Watch() are built OUTSIDE reposMu — idx.Watch()
// alone runs a synchronous `git ls-files` subprocess plus one fsnotify.Add per directory, which on a
// large repository is multi-second work. Every navigation tool call resolves through Server.pick,
// which takes reposMu.RLock(), so holding the write lock across that span used to stall every
// already-attached repository's own queries (and list_repos/the Settings status read) for the
// duration of any one repository's attach. The write lock is now held only for the fast-path check
// above and the final registration below, re-checked for the same race there.
func (s *Server) Attach(spec RepoSpec) (RepoInfo, error) {
	if spec.Key == "" {
		return RepoInfo{}, fmt.Errorf("repomap: attach: key is required")
	}
	if info, done, err := s.attachFastPathLocked(spec); done {
		return info, err
	}

	idx := codeindex.Open(s.store, spec.Runner, spec.GitPath, spec.RepoID, spec.Root)
	graph := codegraph.New(s.store, spec.RepoID)
	runCtx, cancel := context.WithCancel(context.Background())

	inst := &repoInstance{
		key: spec.Key, repoID: spec.RepoID, root: spec.Root,
		store: s.store, idx: idx, graph: graph, log: s.log, syncSem: s.initialSyncSem,
		ready: make(chan struct{}), done: make(chan struct{}), syncDone: make(chan struct{}), cancel: cancel,
	}
	watcher, err := idx.Watch(runCtx, s.initialSyncSem)
	if err != nil {
		// A watcher failure is not fatal to serving what has already synced — logged, not
		// returned, the same posture a bind failure gets.
		s.log.Warn("repo-map watcher", "scope", "repomap", "repo", spec.RepoID, "err", err)
	}
	inst.watcher = watcher

	// Re-check under the write lock: spec.Key (or a case-insensitive collision) may have been
	// claimed by a concurrent Attach while this one was building outside it. Losing that race means
	// closing what was just speculatively built rather than registering it.
	s.reposMu.Lock()
	if existing, ok := s.repos[spec.Key]; ok {
		s.reposMu.Unlock()
		inst.discardUnregistered()
		if existing.repoID == spec.RepoID && existing.root == spec.Root {
			return existing.info(), nil
		}
		return RepoInfo{}, fmt.Errorf("repomap: attach: key %q is already attached to a different repository", spec.Key)
	}
	lower := strings.ToLower(spec.Key)
	for k := range s.repos {
		if strings.ToLower(k) == lower {
			s.reposMu.Unlock()
			inst.discardUnregistered()
			return RepoInfo{}, fmt.Errorf("repomap: attach: key %q collides (case-insensitively) with already-attached %q", spec.Key, k)
		}
	}

	s.repos[spec.Key] = inst
	s.order = append(s.order, spec.Key)
	s.reposMu.Unlock()

	go inst.runInitialSync(runCtx, s.home)

	return inst.info(), nil
}

// AttachDir is the headless binary's own entry point (cmd/kira-repo-map): resolves dir's repository
// identity via resolveRepo (repo.go, unchanged) — a real git worktree, or §4.4's degraded fallback
// against whatever the desktop app has already indexed — then Attach's it. key "" derives a key from
// the resolved root's own base name.
func (s *Server) AttachDir(ctx context.Context, key, dir string) (RepoInfo, error) {
	resolved, err := resolveRepo(ctx, s.store, dir)
	if err != nil {
		return RepoInfo{}, err
	}
	if key == "" {
		key = filepath.Base(resolved.root)
	}
	return s.Attach(RepoSpec{
		Key: key, RepoID: resolved.repoID, Root: resolved.root,
		GitPath: resolved.gitPath, Runner: resolved.runner,
	})
}

// Detach removes key from the servable set immediately (no later call can resolve it, Server.pick),
// then drains any tool call already in flight against it before closing its index/watcher/sync lock
// — asynchronously, so one repository's revoke can never block another's calls. Both halves matter:
// closing the index under an in-flight call is a use-after-close on a *sql.DB-backed reader, and
// holding reposMu for the drain would block every other repository's calls for up to readyTimeout.
// A no-op for a key that is not attached.
func (s *Server) Detach(key string) {
	s.reposMu.Lock()
	inst, ok := s.repos[key]
	if !ok {
		s.reposMu.Unlock()
		return
	}
	delete(s.repos, key)
	order := make([]string, 0, len(s.order))
	for _, k := range s.order {
		if k != key {
			order = append(order, k)
		}
	}
	s.order = order
	s.reposMu.Unlock()

	close(inst.done)
	s.detachWG.Add(1)
	go func() {
		defer s.detachWG.Done()
		inst.inflight.Wait()
		inst.close()
	}()
}

// Rekey renames an attached repository's own client-facing key in place (bridge.RepoMapService's
// own rename hook) — a map-key move only; the index, graph, watcher and any in-flight call are
// untouched.
func (s *Server) Rekey(oldKey, newKey string) error {
	if newKey == "" {
		return fmt.Errorf("repomap: rekey: new key is required")
	}
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	if oldKey == newKey {
		return nil
	}
	inst, ok := s.repos[oldKey]
	if !ok {
		return fmt.Errorf("repomap: rekey: %q is not attached", oldKey)
	}
	lower := strings.ToLower(newKey)
	for k := range s.repos {
		if k != oldKey && strings.ToLower(k) == lower {
			return fmt.Errorf("repomap: rekey: %q collides (case-insensitively) with already-attached %q", newKey, k)
		}
	}
	delete(s.repos, oldKey)
	inst.key = newKey
	s.repos[newKey] = inst
	for i, k := range s.order {
		if k == oldKey {
			s.order[i] = newKey
			break
		}
	}
	return nil
}

// Repos lists every attached repository in attach order — list_repos' own data source (tools.go)
// and bridge.RepoMapService's own status projection.
func (s *Server) Repos() []RepoInfo {
	s.reposMu.RLock()
	defer s.reposMu.RUnlock()
	out := make([]RepoInfo, 0, len(s.order))
	for _, k := range s.order {
		if inst, ok := s.repos[k]; ok {
			out = append(out, inst.info())
		}
	}
	return out
}

// pick resolves name (a tool call's own `repo` argument) to one attached repository, in this order:
// (1) name empty and exactly one attached -> that one; (2) name empty and none attached -> an error
// naming Settings; (3) name empty and several attached -> an error listing every key; (4) name given
// -> exact key, then case-insensitive key, then exact root path match, else an error listing every
// key. On a hit, it registers the call against the instance's own inflight WaitGroup while still
// holding reposMu.RLock() — every handler must `defer inst.inflight.Done()`. That ordering is the
// whole drain guarantee (Detach, above): Detach takes the write lock, so it can never interleave
// between this map read and the Add.
func (s *Server) pick(name string) (*repoInstance, *mcp.CallToolResult) {
	s.reposMu.RLock()
	defer s.reposMu.RUnlock()

	if name == "" {
		switch len(s.order) {
		case 0:
			res, _, _ := errResult("no repositories are shared with this server — grant one in Kira Studio's Settings → Code intelligence.")
			return nil, res
		case 1:
			inst := s.repos[s.order[0]]
			inst.inflight.Add(1)
			return inst, nil
		default:
			res, _, _ := errResult(fmt.Sprintf("several repositories are attached; pass repo=<one of: %s>", strings.Join(s.order, ", ")))
			return nil, res
		}
	}

	if inst, ok := s.repos[name]; ok {
		inst.inflight.Add(1)
		return inst, nil
	}
	lower := strings.ToLower(name)
	for _, k := range s.order {
		if strings.ToLower(k) == lower {
			inst := s.repos[k]
			inst.inflight.Add(1)
			return inst, nil
		}
	}
	for _, k := range s.order {
		inst := s.repos[k]
		if inst.root == name {
			inst.inflight.Add(1)
			return inst, nil
		}
	}
	res, _, _ := errResult(fmt.Sprintf("no attached repository matches %q; pass repo=<one of: %s>", name, strings.Join(s.order, ", ")))
	return nil, res
}
