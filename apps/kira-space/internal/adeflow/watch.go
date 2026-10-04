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

	var (
		mu      sync.Mutex
		timer   *time.Timer
		stopped bool
		done    = make(chan struct{})
		fire    = func() {
			mu.Lock()
			if stopped {
				mu.Unlock()
				return
			}
			mu.Unlock()
			onChange()
		}
		schedule = func() {
			mu.Lock()
			defer mu.Unlock()
			if stopped {
				return
			}
			if timer != nil {
				timer.Stop()
			}
			timer = time.AfterFunc(watchDebounce, fire)
		}
	)
	go func() {
		defer close(done)
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				name := filepath.Clean(ev.Name)
				switch {
				case name == dir:
					if ev.Has(fsnotify.Create) {
						_ = w.Add(dir)
					}
					schedule()
				case filepath.Dir(name) == dir:
					base := filepath.Base(name)
					if strings.HasSuffix(base, ".yaml") && !strings.HasPrefix(base, ".") {
						schedule()
					}
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
		mu.Lock()
		stopped = true
		if timer != nil {
			timer.Stop()
		}
		mu.Unlock()
		w.Close()
		<-done
	}, nil
}
