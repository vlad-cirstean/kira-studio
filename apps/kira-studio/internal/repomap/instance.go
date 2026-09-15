package repomap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// repoInstance is one attached repository's own index, graph, watcher and readiness gate — P67d
// §3.2's per-repository state, split out of Server so one Server can serve any number of them (D1:
// one server, one port, one token, N attached repositories). Everything here was previously part of
// Server itself, back when a Server was exactly one repository by construction (§9 of C3's own
// plan, closed by this phase).
type repoInstance struct {
	key    string // client-facing name a tool call passes as `repo` — unique per Server
	repoID string
	root   string

	store   *codeindex.Store // the Server's own store, borrowed — never closed here
	idx     *codeindex.Index
	graph   *codegraph.Graph
	watcher *codeindex.Watcher
	log     *slog.Logger

	// lockMu guards lock — written by runInitialSync's own background goroutine, read and cleared
	// by close, which can run concurrently with it (Detach racing a still-in-flight initial sync is
	// a real sequence, not just a test artifact).
	lockMu sync.Mutex
	lock   *codeindex.SyncLock

	ready     chan struct{}
	readyOnce sync.Once

	// inflight counts tool calls currently resolved against this instance (Server.pick's own
	// Add, attach.go) — Detach waits it out before closing anything underneath a call already in
	// progress.
	inflight sync.WaitGroup
	// done is closed by Detach: wakes a pending waitReady immediately rather than after the full
	// readyTimeout (attach.go's own revoke path).
	done   chan struct{}
	cancel context.CancelFunc

	closeOnce sync.Once
}

// runInitialSync runs behind the per-repository flock, then closes the readiness gate exactly once
// regardless of outcome — a Sync error still opens the gate (a tool call then gets whatever
// codegraph can answer from an empty or partial index, which is honest; it does not hang forever).
func (inst *repoInstance) runInitialSync(ctx context.Context, home string) {
	lock, acquired, err := codeindex.AcquireSyncLock(home, inst.repoID, codeindex.DefaultSyncLockTimeout)
	if err != nil {
		inst.log.Warn("repo-map sync lock", "scope", "repomap", "repo", inst.repoID, "err", err)
	}
	inst.lockMu.Lock()
	inst.lock = lock
	inst.lockMu.Unlock()
	if !acquired {
		inst.log.Debug("repo-map sync lock: proceeding without it (timeout or unsupported platform)", "scope", "repomap", "repo", inst.repoID)
	}

	stats, err := inst.idx.Sync(ctx)
	if lock != nil {
		lock.Release()
		inst.lockMu.Lock()
		inst.lock = nil
		inst.lockMu.Unlock()
	}
	if err != nil {
		inst.log.Error("repo-map initial sync", "scope", "repomap", "repo", inst.repoID, "err", err)
	} else {
		inst.log.Info("repo-map initial sync complete", "scope", "repomap", "repo", inst.repoID,
			"filesParsed", stats.FilesParsed, "filesSkipped", stats.FilesSkipped, "filesDeleted", stats.FilesDeleted)
	}
	inst.readyOnce.Do(func() { close(inst.ready) })
}

// waitReady blocks until the initial Sync has completed and no later full Sync is in flight, or
// readyTimeout elapses, or this instance is detached — whichever first. A revoke (done closed) never
// leaves a caller blocked for the remaining readyTimeout.
func (inst *repoInstance) waitReady(ctx context.Context) error {
	deadline := time.After(readyTimeout)
	select {
	case <-inst.ready:
	case <-inst.done:
		return errors.New("repository access was revoked")
	case <-ctx.Done():
		return ctx.Err()
	case <-deadline:
		return fmt.Errorf("repo-map index for %s is still building (initial sync running past %s) — retry shortly", inst.root, readyTimeout)
	}
	// The gate above is one-shot, so a later full Sync (a watcher rescan) runs behind an
	// already-open gate. Wait it out under the same deadline rather than answer from a mid-rebuild
	// index.
	select {
	case <-inst.idx.SyncSettled():
		return nil
	case <-inst.done:
		return errors.New("repository access was revoked")
	case <-ctx.Done():
		return ctx.Err()
	case <-deadline:
		return fmt.Errorf("repo-map index for %s is reindexing (running past %s) — retry shortly", inst.root, readyTimeout)
	}
}

// info projects this instance's current state into RepoInfo (attach.go) — Ready/Degraded read
// without blocking, since a caller (list_repos, Server.Repos) must never wait on a sync in flight
// just to describe one.
func (inst *repoInstance) info() RepoInfo {
	ready := false
	select {
	case <-inst.ready:
		ready = true
	default:
	}
	degraded := ""
	if st := inst.idx.SyncState(); st.LastErr != nil {
		degraded = st.LastErr.Error()
	}
	return RepoInfo{Key: inst.key, RepoID: inst.repoID, Root: inst.root, Ready: ready, Degraded: degraded}
}

// close mirrors Server.Close's own former per-repo half: cancel, stop the watcher, release the sync
// lock if held, close the index — never the store, which the Server owns. Idempotent, and only ever
// called once inflight has drained to zero (Server.Detach).
func (inst *repoInstance) close() {
	inst.closeOnce.Do(func() {
		inst.cancel()
		if inst.watcher != nil {
			_ = inst.watcher.Close()
		}
		inst.lockMu.Lock()
		lock := inst.lock
		inst.lock = nil
		inst.lockMu.Unlock()
		if lock != nil {
			lock.Release()
		}
		inst.idx.Close()
	})
}
