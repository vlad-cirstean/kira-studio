package ade

import (
	"context"
	"errors"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/runoutcome"
)

// live.go is the per-run and per-setup cancel registry (R7): one mechanism for StopRun, Take over
// and Archive. A cancel cause says why; app quit cancels b.ctx and carries no cause.

var (
	errStopped     = errors.New("stopped by you")
	errBoardClosed = errors.New("the task board is closed")
	errTakenOver   = errors.New("taken over in Claude Code")
	errArchived    = errors.New("task archived")
)

// stopWait bounds how long a stop waits for the process to exit; a var so a test can shorten it.
var stopWait = 15 * time.Second

type liveRun struct {
	cancel context.CancelCauseFunc
	done   chan struct{} // closed once the run's outcome is recorded
}

// beginLive registers id in m and returns its context and the func that ends it. m is b.live or
// b.setupLive.
func (b *TaskBoard) beginLive(m map[string]*liveRun, id string) (context.Context, func()) {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	return b.beginLiveLocked(m, id)
}

// beginLiveLocked is beginLive with runMu held.
func (b *TaskBoard) beginLiveLocked(m map[string]*liveRun, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(b.ctx)
	lr := &liveRun{cancel: cancel, done: make(chan struct{})}
	m[id] = lr
	return ctx, func() {
		b.runMu.Lock()
		delete(m, id)
		b.runMu.Unlock()
		cancel(nil)
		close(lr.done)
	}
}

// cancelLive cancels id with cause and returns the channel that closes when it has ended; nil when
// id is not live.
func (b *TaskBoard) cancelLive(m map[string]*liveRun, id string, cause error) <-chan struct{} {
	b.runMu.Lock()
	lr := m[id]
	b.runMu.Unlock()
	if lr == nil {
		return nil
	}
	lr.cancel(cause)
	return lr.done
}

// awaitEnd waits for a cancelled run to record its outcome. Never call it with a task mutex held:
// the run's completion takes that mutex.
func (b *TaskBoard) awaitEnd(done <-chan struct{}) error {
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-time.After(stopWait):
		return invalid("the process did not stop in time")
	}
}

// stopOutcome maps a user-driven cancel cause to the run's outcome; ok is false for any other end.
func stopOutcome(ctx context.Context) (outcome, bool) {
	if ctx.Err() == nil {
		return outcome{}, false
	}
	cancelled := func(state string, reason string) (outcome, bool) {
		o := runoutcome.Outcome{Status: runoutcome.StatusCancelled, Source: runoutcome.SourceUser, Reason: reason}
		out := fromOutcome(state, o)
		out.noAdvance = true
		return out, true
	}
	switch context.Cause(ctx) {
	case errStopped:
		return cancelled(model.AdeRunStuck, errStopped.Error())
	case errTakenOver:
		return cancelled(model.AdeRunStuck, errTakenOver.Error())
	case errArchived:
		return cancelled(model.AdeRunFailed, "stopped: "+errArchived.Error())
	}
	return outcome{}, false
}

// beginArchive blocks new launches for the task until the returned func runs.
func (b *TaskBoard) beginArchive(taskID string) func() {
	b.runMu.Lock()
	b.archiving[taskID]++
	b.runMu.Unlock()
	return func() {
		b.runMu.Lock()
		defer b.runMu.Unlock()
		if b.archiving[taskID]--; b.archiving[taskID] <= 0 {
			delete(b.archiving, taskID)
		}
	}
}

// checkNotArchiving rejects a launch for a task whose archive is in progress.
func (b *TaskBoard) checkNotArchiving(taskID string) error {
	b.runMu.Lock()
	defer b.runMu.Unlock()
	if b.archiving[taskID] > 0 {
		return invalid("task is being archived")
	}
	return nil
}
