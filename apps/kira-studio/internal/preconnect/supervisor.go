// Package preconnect is the Go analogue of src/main/preconnect.ts (P11): it owns every child
// process the app spawns on the user's behalf, running a pre-connect shell command before an
// adapter connects and, once armed, watching a long-lived sidecar for an unexpected exit.
package preconnect

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
)

// Kind values match preconnect.ts's PreconnectStart discriminant.
const (
	KindOneShot = "oneshot"
	KindSidecar = "sidecar"
)

// Start is resolved once the script is judged ready.
type Start struct {
	Kind string
}

// Exit mirrors preconnect.ts's PreconnectExit.
type Exit struct {
	ConnectionID string
	Code         *int   // nil when the process was killed by a signal (or its exit status is unknown)
	Signal       string // "" when it exited normally; otherwise a Node-style name (signal.go)
	LastStderr   *string
}

// settleWindow and killGrace are package vars, not consts (P55 §2 D9, following P54 D10's
// precedent for maxDataFrameBytes): supervisor_internal_test.go lowers them so the sidecar and
// kill-escalation tests don't each cost 2s of wall clock. Production keeps preconnect.ts's own
// 2s/2s.
var (
	settleWindow = 2 * time.Second
	killGrace    = 2 * time.Second
)

// outcome is the classified result of cmd.Wait().
type outcome struct {
	code   *int
	signal string
}

// entry tracks one spawned process. It is only ever placed in Supervisor.entries once it has
// settled as a sidecar (§4.4) — an entry that exits within the settle window is never tracked at
// all, exactly as preconnect.ts's entries map only ever gains an entry from its settleTimer
// callback.
type entry struct {
	pid    int
	exited chan struct{} // closed exactly once, after the exit is fully classified

	tailMu sync.Mutex
	tail   tailTracker

	mu      sync.Mutex
	armed   bool
	killing bool
	dead    *Exit // set if the process exited before Arm consumed it
}

func (e *entry) pushStderr(chunk string) {
	e.tailMu.Lock()
	e.tail.push(chunk)
	e.tailMu.Unlock()
}

func (e *entry) lastStderr() *string {
	e.tailMu.Lock()
	v := e.tail.value()
	e.tailMu.Unlock()
	if v == "" {
		return nil
	}
	return &v
}

// Supervisor is the Go analogue of preconnect.ts's PreconnectSupervisor.
type Supervisor struct {
	mu      sync.Mutex
	entries map[string]*entry
	exits   notify.Emitter[Exit]
}

func New() *Supervisor {
	return &Supervisor{entries: make(map[string]*entry)}
}

// OnExit registers fn for every exit fired after arming (or discovered dead-on-arm). It returns
// an unsubscribe func.
func (s *Supervisor) OnExit(fn func(Exit)) (unsubscribe func()) {
	return s.exits.Subscribe(fn)
}

// Start kills anything already tracked for connectionID, spawns command, and returns once the
// script is judged ready. It returns an error if the script exits non-zero, dies on a signal, or
// fails to spawn before the settle window elapses — the message names the exit code/signal and
// the last stderr line, exactly as preconnect.ts:182 composes it.
func (s *Supervisor) Start(connectionID, command string) (Start, error) {
	s.mu.Lock()
	existing := s.entries[connectionID]
	s.mu.Unlock()
	if existing != nil {
		s.killEntry(connectionID, existing)
	}

	dir, err := os.UserHomeDir()
	if err != nil {
		return Start{}, fmt.Errorf("Pre-connect script could not start: %w", err)
	}

	cmd := exec.Command("/bin/sh", "-c", command)
	cmd.Dir = dir
	cmd.Stdout = nil // D8: /dev/null, not a pipe nobody reads — deliberately stricter than the TS original.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = withAugmentedPath(os.Environ())

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Start{}, fmt.Errorf("Pre-connect script could not start: %w", err)
	}

	if err := cmd.Start(); err != nil {
		slog.Error(fmt.Sprintf("preconnect[%s] failed to spawn: %s", connectionID, err), "scope", "preconnect")
		return Start{}, fmt.Errorf("Pre-connect script could not start: %s", err)
	}

	e := &entry{pid: cmd.Process.Pid, exited: make(chan struct{})}
	outcomeCh := make(chan outcome, 1)

	go func() {
		buf := make([]byte, 4096)
		for {
			n, rerr := stderr.Read(buf)
			if n > 0 {
				e.pushStderr(string(buf[:n]))
			}
			if rerr != nil {
				break
			}
		}
		// 'close', not 'exit' (§1.4 / P54 §1.2): the stderr pipe must be fully drained before
		// Wait() is called, or the rejection message below loses its tail.
		outcomeCh <- classifyExit(cmd.Wait())
		close(e.exited)
	}()

	timer := time.NewTimer(settleWindow)
	defer timer.Stop()

	select {
	case <-timer.C:
		s.mu.Lock()
		s.entries[connectionID] = e
		s.mu.Unlock()
		go s.awaitExit(connectionID, e, outcomeCh)
		return Start{Kind: KindSidecar}, nil

	case out := <-outcomeCh:
		if out.signal == "" && out.code != nil && *out.code == 0 {
			slog.Info(fmt.Sprintf("preconnect[%s] one-shot exited 0", connectionID), "scope", "preconnect")
			return Start{Kind: KindOneShot}, nil
		}
		return Start{}, fmt.Errorf("Pre-connect script failed %s", exitDetail(out, e.lastStderr()))
	}
}

// awaitExit runs for the lifetime of a settled sidecar entry: it blocks for the process's real
// exit and then routes it via the same three-way killing/armed/dead test preconnect.ts:186-203
// uses.
func (s *Supervisor) awaitExit(connectionID string, e *entry, outcomeCh chan outcome) {
	out := <-outcomeCh

	e.mu.Lock()
	wasKilling := e.killing
	armed := e.armed
	e.mu.Unlock()

	// A kill this supervisor itself initiated (Stop/Start superseding a previous entry) must stay
	// silent — killEntry owns removing it.
	if wasKilling {
		return
	}

	exit := Exit{ConnectionID: connectionID, Code: out.code, Signal: out.signal, LastStderr: e.lastStderr()}

	if armed {
		s.exits.Emit(exit)
		s.mu.Lock()
		if s.entries[connectionID] == e {
			delete(s.entries, connectionID)
		}
		s.mu.Unlock()
		return
	}

	// Died between Start resolving and Arm being called — Arm reports it.
	e.mu.Lock()
	e.dead = &exit
	e.mu.Unlock()
}

// Arm marks connectionID's sidecar as armed: from here on, any exit fires OnExit. If the process
// already died between Start resolving and this call, it fires OnExit synchronously.
func (s *Supervisor) Arm(connectionID string) {
	s.mu.Lock()
	e, ok := s.entries[connectionID]
	s.mu.Unlock()
	if !ok {
		return
	}

	e.mu.Lock()
	dead := e.dead
	if dead == nil {
		e.armed = true
	}
	e.mu.Unlock()

	if dead == nil {
		return
	}
	s.mu.Lock()
	if s.entries[connectionID] == e {
		delete(s.entries, connectionID)
	}
	s.mu.Unlock()
	s.exits.Emit(*dead)
}

// Stop kills the process tracked for connectionID, if any. Idempotent; self-inflicted kills
// never fire OnExit.
func (s *Supervisor) Stop(connectionID string) {
	s.mu.Lock()
	e, ok := s.entries[connectionID]
	s.mu.Unlock()
	if !ok {
		return
	}
	s.killEntry(connectionID, e)
}

// StopAll kills every tracked process concurrently and waits for them all to exit.
func (s *Supervisor) StopAll() {
	s.mu.Lock()
	entries := make(map[string]*entry, len(s.entries))
	for connectionID, e := range s.entries {
		entries[connectionID] = e
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for connectionID, e := range entries {
		wg.Add(1)
		go func(connectionID string, e *entry) {
			defer wg.Done()
			s.killEntry(connectionID, e)
		}(connectionID, e)
	}
	wg.Wait()
}

// killEntry sends SIGTERM to the process group, escalates to SIGKILL after killGrace, waits for
// the real exit, and removes the entry. Marking killing=true first ensures awaitExit's own exit
// routing stays silent for this kill.
func (s *Supervisor) killEntry(connectionID string, e *entry) {
	e.mu.Lock()
	e.killing = true
	e.mu.Unlock()

	_ = syscall.Kill(-e.pid, syscall.SIGTERM)

	escalate := time.AfterFunc(killGrace, func() {
		_ = syscall.Kill(-e.pid, syscall.SIGKILL)
	})
	<-e.exited
	escalate.Stop()

	s.mu.Lock()
	if s.entries[connectionID] == e {
		delete(s.entries, connectionID)
	}
	s.mu.Unlock()
}

// classifyExit turns cmd.Wait()'s error into an outcome: nil code+signal means the process is
// unavailable to classify further (mirrors Node's code:null, signal:null edge case), a non-nil
// code means a normal exit, and a signal name means it was killed.
func classifyExit(err error) outcome {
	if err == nil {
		zero := 0
		return outcome{code: &zero}
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if ws, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			if ws.Signaled() {
				return outcome{signal: signalName(ws.Signal())}
			}
			code := ws.ExitStatus()
			return outcome{code: &code}
		}
		code := exitErr.ExitCode()
		return outcome{code: &code}
	}
	// cmd.Wait() returning a non-ExitError (e.g. the process was never started) has no exit code
	// or signal to report.
	return outcome{}
}

// exitDetail formats preconnect.ts:178-181's `${detail}${tail}` pair.
func exitDetail(out outcome, tail *string) string {
	var detail string
	switch {
	case out.signal != "":
		detail = fmt.Sprintf("(signal %s)", out.signal)
	case out.code != nil:
		detail = fmt.Sprintf("(exit %d)", *out.code)
	default:
		detail = "(exit unknown)"
	}
	if tail != nil && *tail != "" {
		detail += ": " + *tail
	}
	return detail
}

// withAugmentedPath replaces the PATH= entry in env — never appending a second one — with
// itself plus preconnect.ts:119's exact fallback locations.
func withAugmentedPath(env []string) []string {
	out := make([]string, 0, len(env)+1)
	found := false
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			out = append(out, kv+":/usr/local/bin:/opt/homebrew/bin")
			found = true
			continue
		}
		out = append(out, kv)
	}
	if !found {
		out = append(out, "PATH=:/usr/local/bin:/opt/homebrew/bin")
	}
	return out
}
