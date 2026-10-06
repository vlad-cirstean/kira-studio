package adeflow

import (
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const watchDebounce = 200 * time.Millisecond

// Watch calls onChange (debounced 200ms, one call per burst) when a *.yaml file in dir is created,
// written, renamed or removed. Hidden files (the writer's temp files) are ignored. A missing dir is
// fine: its parent is watched until the dir appears, then onChange fires once for it. stop ends the
// watch and returns after any in-flight onChange finishes.
func Watch(dir string, onChange func()) (stop func(), err error) {
	dir = filepath.Clean(dir)
	parent := filepath.Dir(dir)
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("adeflow: watcher: %w", err)
	}
	if err := w.Add(parent); err != nil {
		w.Close()
		return nil, fmt.Errorf("adeflow: watch %s: %w", parent, err)
	}
	// Add after the parent: a dir created in between is caught by the parent's event.
	_ = w.Add(dir)

	done := make(chan struct{})
	d := &debouncer{fn: onChange}
	go func() {
		defer close(done)
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if relevantEvent(dir, ev) {
					if filepath.Clean(ev.Name) == dir && ev.Has(fsnotify.Create) {
						_ = w.Add(dir)
					}
					d.schedule()
				}
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				slog.Warn("ade workflows: watch", "scope", "ade", "err", err)
			}
		}
	}()
	return func() {
		d.stop()
		w.Close()
		<-done
	}, nil
}

// relevantEvent reports whether ev touches dir itself or a visible *.yaml file in it.
func relevantEvent(dir string, ev fsnotify.Event) bool {
	name := filepath.Clean(ev.Name)
	if name == dir {
		return true
	}
	base := filepath.Base(name)
	return filepath.Dir(name) == dir && strings.HasSuffix(base, ".yaml") && !strings.HasPrefix(base, ".")
}

// debouncer coalesces bursts into one fn call after watchDebounce and drops calls once stopped.
type debouncer struct {
	fn      func()
	mu      sync.Mutex
	timer   *time.Timer
	stopped bool
	running sync.WaitGroup // in-flight fn calls; stop waits for them
}

func (d *debouncer) schedule() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return
	}
	if d.timer != nil {
		d.timer.Stop()
	}
	d.timer = time.AfterFunc(watchDebounce, d.fire)
}

func (d *debouncer) fire() {
	d.mu.Lock()
	if d.stopped {
		d.mu.Unlock()
		return
	}
	d.running.Add(1)
	d.mu.Unlock()
	defer d.running.Done()
	d.fn()
}

func (d *debouncer) stop() {
	d.mu.Lock()
	d.stopped = true
	if d.timer != nil {
		d.timer.Stop()
	}
	d.mu.Unlock()
	d.running.Wait()
}
