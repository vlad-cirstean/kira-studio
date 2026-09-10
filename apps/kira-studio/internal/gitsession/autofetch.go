package gitsession

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

// autoFetchState is one RepoEntry's own background-fetch timer (D23) — one per repository,
// regardless of how many windows have it open, silent, credential-free and self-disabling.
type autoFetchState struct {
	mu       sync.Mutex
	timer    *time.Timer
	disabled bool
}

// startAutoFetch arms the timer if minutes > 0 — called once, by newRepoEntry, with whatever the
// server-owned interval reads as at entry-creation time. The first tick always waits a full
// interval (D23: a tick racing a window's cold start would compete with the initial graph load).
func (e *RepoEntry) startAutoFetch(minutes int) {
	if minutes <= 0 {
		return
	}
	e.autoFetch.mu.Lock()
	defer e.autoFetch.mu.Unlock()
	if e.autoFetch.disabled || e.autoFetch.timer != nil {
		return
	}
	e.autoFetch.timer = time.AfterFunc(time.Duration(minutes)*time.Minute, e.autoFetchTick)
}

// ensureAutoFetch re-reads this entry's current settings and arms the timer if the interval is now
// non-zero (F4/D5) — called from Conn.Open on the path that stores a new hold, not only from
// newRepoEntry. startAutoFetch already no-ops when a timer is already running or the entry is
// `disabled` (a fetch that failed once stays off for the entry's life, G7 D23), so N windows
// opening the same repository arm exactly one timer, and this can never resurrect one G7 killed.
// Fixes the off→on direction, which newRepoEntry-only arming never could: a repository opened
// while auto-fetch read as 0 never got a timer, and no later settings change could ever start one.
func (e *RepoEntry) ensureAutoFetch() {
	_, minutes, _ := e.settings()
	if minutes > 0 {
		e.startAutoFetch(minutes)
	}
}

// stopAutoFetch is teardown's own call — permanent, the entry is going away.
func (e *RepoEntry) stopAutoFetch() {
	e.autoFetch.mu.Lock()
	defer e.autoFetch.mu.Unlock()
	if e.autoFetch.timer != nil {
		e.autoFetch.timer.Stop()
		e.autoFetch.timer = nil
	}
	e.autoFetch.disabled = true
}

func (e *RepoEntry) rescheduleAutoFetch(minutes int) {
	e.autoFetch.mu.Lock()
	defer e.autoFetch.mu.Unlock()
	if e.autoFetch.disabled {
		return
	}
	e.autoFetch.timer = time.AfterFunc(time.Duration(minutes)*time.Minute, e.autoFetchTick)
}

func (e *RepoEntry) disableAutoFetch() {
	e.autoFetch.mu.Lock()
	e.autoFetch.disabled = true
	e.autoFetch.timer = nil
	e.autoFetch.mu.Unlock()
}

// pauseAutoFetch stops the ticking loop for a user-set interval of zero — deliberately NOT the
// same as disableAutoFetch (G30 round-1 functional-correctness review, finding #8): `disabled` is
// this entry's permanent, for-its-whole-life kill switch, reserved for a genuine fetch failure
// (most commonly AuthFailed). Before this fix, autoFetchTick called disableAutoFetch for BOTH
// cases — so a user turning fetch.autoInterval to 0 tripped the same permanent switch a real
// failure does, and startAutoFetch's own `e.autoFetch.disabled` guard then refused to ever re-arm
// again, even after the user set the interval back to a positive value: auto-fetch stayed off
// forever, silently, for the rest of the entry's life. Clearing only `timer` (never `disabled`)
// leaves startAutoFetch's other guard (`timer != nil`) false too, so the next ensureAutoFetch call
// (Conn.Open, the same off→on path D5 already established) arms a fresh timer once the interval
// reads positive again.
func (e *RepoEntry) pauseAutoFetch() {
	e.autoFetch.mu.Lock()
	e.autoFetch.timer = nil
	e.autoFetch.mu.Unlock()
}

// autoFetchTick re-reads the server-owned interval fresh (so a setting change takes effect within
// one interval, with no need to recreate the entry) and, when nothing else is using the
// repository, runs one silent fetch through the SAME RunRemote path an explicit fetch takes — with
// conn == nil, which is what makes it silent and credential-free structurally rather than by
// policy (D23): no askpass env at all (withAskpass's own nil-conn guard), no progress emission
// (RunRemote's progressEmit is a no-op for a nil conn), and it never touches the undo slot
// (RunRemote never does, for any conn). "Busy right now" (another op running, or Repo.Write held)
// reschedules rather than disabling — only a genuine fetch failure (most commonly AuthFailed, since
// a remote needing a credential fails immediately with no prompt) disables the timer for the rest
// of this entry's life, logged once by the caller... no caller logs it today; disabling IS the
// user-visible signal (G8's own open item: no toolbar marker exists yet to surface it further).
func (e *RepoEntry) autoFetchTick() {
	e.autoFetch.mu.Lock()
	disabled := e.autoFetch.disabled
	e.autoFetch.mu.Unlock()
	if disabled {
		return
	}

	_, minutes, _ := e.settings()
	if minutes <= 0 {
		e.pauseAutoFetch()
		return
	}
	if e.Repo.Writing() {
		e.rescheduleAutoFetch(minutes)
		return
	}

	remote, ok := e.pickAutoFetchRemote(context.Background())
	if !ok {
		e.rescheduleAutoFetch(minutes)
		return
	}

	result, err := e.RunRemote(context.WithoutCancel(context.Background()), nil, RemoteOpParams{
		Kind: "fetch", Remote: remote, Prune: true,
	}, RemoteDeps{})
	if err != nil {
		e.disableAutoFetch()
		return
	}
	if !result.OK {
		if result.Error != nil && result.Error.Kind == "OperationInProgress" {
			e.rescheduleAutoFetch(minutes) // another op is running right now — not a failure.
			return
		}
		e.disableAutoFetch()
		return
	}
	e.rescheduleAutoFetch(minutes)
}

// pickAutoFetchRemote is D23's own rule: "origin" if it exists, else the sole remote if there is
// exactly one, else the tick is skipped (no guessing among several).
func (e *RepoEntry) pickAutoFetchRemote(ctx context.Context) (string, bool) {
	raw, err := e.runOne(ctx, gitops.RemotesArgs())
	if err != nil {
		return "", false
	}
	var remotes []string
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line != "" {
			remotes = append(remotes, line)
		}
	}
	for _, r := range remotes {
		if r == "origin" {
			return "origin", true
		}
	}
	if len(remotes) == 1 {
		return remotes[0], true
	}
	return "", false
}
