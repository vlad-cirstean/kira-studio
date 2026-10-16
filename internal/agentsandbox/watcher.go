package agentsandbox

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// Seatbelt reports denials only to the unified log. One shared `log stream` child serves every
// watched run and exits after a grace period once none is left.
const logStreamPredicate = `sender == "Sandbox" AND eventMessage CONTAINS " deny("`

var (
	watcherGrace    = 30 * time.Second
	watcherBackoffs = []time.Duration{time.Second, 5 * time.Second, 30 * time.Second}
	denyLine        = regexp.MustCompile(`^Sandbox: (.+)\((\d+)\) deny\(\d+\) (\S+)(?: (.*))?$`)
)

// parseDenial reads one ndjson line of `log stream`.
func parseDenial(line string) (pid int, d Denial, ok bool) {
	var ev struct {
		EventMessage string `json:"eventMessage"`
	}
	if json.Unmarshal([]byte(line), &ev) != nil {
		return 0, Denial{}, false
	}
	m := denyLine.FindStringSubmatch(ev.EventMessage)
	if m == nil {
		return 0, Denial{}, false
	}
	pid, _ = strconv.Atoi(m[2])
	return pid, Denial{At: time.Now(), Op: m[3], Target: m[4], Process: m[1]}, true
}

type watcher struct {
	h *hub
	// ppid reports a live process's parent; false when the process is gone.
	ppid  func(int) (int, bool)
	start func(ctx context.Context) (io.ReadCloser, func() error, error)
	// backoffs are the waits between restarts of the log stream.
	backoffs []time.Duration

	mu     sync.Mutex
	roots  map[string]int
	names  map[string]map[string]bool // run -> process names already attributed to it
	cancel context.CancelFunc
	idle   *time.Timer
}

func newWatcher(h *hub) *watcher {
	return &watcher{h: h, ppid: parentPID, start: startLogStream, backoffs: watcherBackoffs, roots: map[string]int{}, names: map[string]map[string]bool{}}
}

func startLogStream(ctx context.Context) (io.ReadCloser, func() error, error) {
	cmd := exec.CommandContext(ctx, "/usr/bin/log", "stream", "--style", "ndjson", "--level", "default", "--predicate", logStreamPredicate)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	return out, cmd.Wait, nil
}

// watch registers pid as run's root and returns the unregister func.
func (w *watcher) watch(pid int, runID string) func() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.roots[runID] = pid
	if w.idle != nil {
		w.idle.Stop()
		w.idle = nil
	}
	if w.cancel == nil {
		ctx, cancel := context.WithCancel(context.Background())
		w.cancel = cancel
		go w.loop(ctx)
	}
	return func() {
		w.mu.Lock()
		defer w.mu.Unlock()
		delete(w.roots, runID)
		delete(w.names, runID)
		if len(w.roots) == 0 && w.idle == nil {
			w.idle = time.AfterFunc(watcherGrace, w.stopIfIdle)
		}
	}
}

func (w *watcher) stopIfIdle() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.roots) == 0 && w.cancel != nil {
		w.cancel()
		w.cancel = nil
	}
	w.idle = nil
}

func (w *watcher) loop(ctx context.Context) {
	failures := 0
	for ctx.Err() == nil {
		out, wait, err := w.start(ctx)
		lines := 0
		if err == nil {
			sc := bufio.NewScanner(out)
			sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
			for sc.Scan() {
				lines++
				w.dispatch(sc.Text())
			}
			_ = wait()
		}
		if ctx.Err() != nil {
			return
		}
		if lines > 0 {
			failures = 0 // a healthy stream earns a fresh retry budget
		}
		if failures >= len(w.backoffs) {
			slog.Warn("sandbox: denial log unavailable; continuing without denials", "scope", "agentsandbox", "err", err)
			w.giveUp(ctx)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(w.backoffs[failures]):
		}
		failures++
	}
}

// giveUp clears the loop's cancel so the next watch starts a new loop.
func (w *watcher) giveUp(ctx context.Context) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if ctx.Err() == nil && w.cancel != nil {
		w.cancel()
		w.cancel = nil
	}
}

func (w *watcher) dispatch(line string) {
	pid, d, ok := parseDenial(line)
	if !ok {
		return
	}
	if runID, ok := w.attribute(pid, d.Process); ok {
		w.h.emit(runID, d)
		return
	}
	slog.Debug("sandbox: unattributed denial", "scope", "agentsandbox", "op", d.Op, "target", d.Target, "process", d.Process)
}

// attribute finds the run owning pid by walking its parents up to a watched root. A vanished process
// belongs to the only watched run when that run already had a denial from a process of the same name;
// the stream is system-wide, so any other vanished process is another app's.
func (w *watcher) attribute(pid int, process string) (string, bool) {
	run, ok := w.walk(pid, process)
	if ok {
		w.mu.Lock()
		if w.names[run] == nil {
			w.names[run] = map[string]bool{}
		}
		w.names[run][process] = true
		w.mu.Unlock()
	}
	return run, ok
}

func (w *watcher) walk(pid int, process string) (string, bool) {
	w.mu.Lock()
	roots := make(map[int]string, len(w.roots))
	for run, root := range w.roots {
		roots[root] = run
	}
	w.mu.Unlock()
	cur := pid
	for range 64 {
		if run, ok := roots[cur]; ok {
			return run, true
		}
		parent, alive := w.ppid(cur)
		if !alive {
			if cur == pid && len(roots) == 1 {
				for _, run := range roots {
					w.mu.Lock()
					known := w.names[run][process]
					w.mu.Unlock()
					return run, known
				}
			}
			return "", false
		}
		if parent <= 1 {
			return "", false
		}
		cur = parent
	}
	return "", false
}
