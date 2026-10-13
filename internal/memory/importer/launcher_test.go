package importer

import (
	"context"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/internal/memory"
)

// inProcessLauncher runs each launched Runner on a goroutine, so tests keep a scripted Agent in
// process. Close stops every runner it started and waits for them.
type inProcessLauncher struct {
	t    *testing.T
	ms   *memory.Store
	opts RunnerOptions

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func newInProcessLauncher(t *testing.T, ms *memory.Store, opts RunnerOptions) *inProcessLauncher {
	ctx, cancel := context.WithCancel(context.Background())
	l := &inProcessLauncher{t: t, ms: ms, opts: opts, ctx: ctx, cancel: cancel}
	t.Cleanup(func() { _ = l.Close() })
	return l
}

func (l *inProcessLauncher) Launch() error {
	r, err := NewRunner(l.ms, l.opts)
	if err != nil {
		return err
	}
	l.wg.Add(1)
	go func() {
		defer l.wg.Done()
		if err := r.Run(l.ctx); err != nil && err != ErrRunnerBusy {
			l.t.Errorf("runner: %v", err)
		}
	}()
	return nil
}

func (l *inProcessLauncher) Close() error {
	l.cancel()
	l.wg.Wait()
	return nil
}
