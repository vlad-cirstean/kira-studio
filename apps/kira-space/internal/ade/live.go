package ade

import (
	"context"
	"errors"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// live.go is the per-run and per-setup cancel registry (R7): one mechanism for StopRun, Take over
// and Archive. A cancel cause says why; app quit cancels b.ctx and carries no cause.

var (
	errStopped   = errors.New("stopped by you")
	errTakenOver = errors.New("taken over in Claude Code")
	errArchived  = errors.New("task archived")
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
	ctx, cancel := context.WithCancelCause(b.ctx)
	lr := &liveRun{cancel: cancel, done: make(chan struct{})}
	b.runMu.Lock()
	m[id] = lr
	b.runMu.Unlock()
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
	switch context.Cause(ctx) {
	case errStopped:
		return outcome{state: model.AdeRunStuck, note: errStopped.Error(), noAdvance: true}, true
	case errTakenOver:
		return outcome{state: model.AdeRunStuck, note: errTakenOver.Error(), noAdvance: true}, true
	case errArchived:
		return outcome{state: model.AdeRunFailed, note: "stopped: " + errArchived.Error(), noAdvance: true}, true
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
