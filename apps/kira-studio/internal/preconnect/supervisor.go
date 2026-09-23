// Package preconnect is the Go analogue of src/main/preconnect.ts (P11): it owns every child
// process the app spawns on the user's behalf, running a pre-connect shell command before an
// adapter connects and, once armed, watching a long-lived sidecar for an unexpected exit.
package preconnect

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kirathecat/kira-studio/internal/notify"
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

// killSignal is syscall.Kill, indirected through a var (postgres/client.go's pgxConnect-as-a-var
// is this codebase's own precedent for the pattern) so a test can observe — without needing to
// actually reach a recycled pid, which isn't reproducible on demand — whether killEntry attempted
// to signal an entry it should have recognised as already dead (P21 round 3 finding 6).
var killSignal = syscall.Kill

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

// stderrWriter feeds cmd.Stderr writes into an entry's tail tracker — see the WaitDelay comment
// at its one call site (Start) for why a plain io.Writer, not StderrPipe, is what lets Wait()
// itself be bounded.
type stderrWriter struct{ e *entry }

func (w stderrWriter) Write(p []byte) (int, error) {
	w.e.pushStderr(string(p))
	return len(p), nil
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
// script is judged ready. It returns an error if the script exits non-zero, dies on a signal,
// fails to spawn before the settle window elapses, or ctx is cancelled first — the message names
// the exit code/signal and the last stderr line, exactly as preconnect.ts:182 composes it.
//
// F4 (P108 Part 3): ctx lets a caller racing this call (connections.Service.Disconnect/Remove
// against an in-flight Connect) abort a script still inside the settle window, when it is not yet
// tracked in s.entries at all — an external Stop(connectionID) call arriving in that window would
// otherwise find nothing to do and silently leave the script running.
func (s *Supervisor) Start(ctx context.Context, connectionID, command string) (Start, error) {
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

	e := &entry{exited: make(chan struct{})}

	cmd := exec.Command("/bin/sh", "-c", command)
	cmd.Dir = dir
	cmd.Stdout = nil // D8: /dev/null, not a pipe nobody reads — deliberately stricter than the TS original.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = withAugmentedPath(os.Environ())
	cmd.Stderr = stderrWriter{e: e}
	// F1 (P108 Part 3): bounds cmd.Wait() itself. cmd.Stderr being a plain io.Writer (not an
	// *os.File) makes the stdlib spawn its own internal pipe-copy goroutine, and Wait() normally
	// blocks until that goroutine sees EOF — which never arrives if a descendant left the process
	// group (setsid, daemon(3)) while keeping the pipe's write end open. WaitDelay makes Wait()
	// forcibly close that pipe (unblocking the copy goroutine with a read error) once it has been
	// this long since the process itself was observed to exit, instead of hanging forever.
	cmd.WaitDelay = killGrace

	if err := cmd.Start(); err != nil {
		slog.Error(fmt.Sprintf("preconnect[%s] failed to spawn: %s", connectionID, err), "scope", "preconnect")
		return Start{}, fmt.Errorf("Pre-connect script could not start: %s", err)
	}
	e.pid = cmd.Process.Pid

	outcomeCh := make(chan outcome, 1)
	go func() {
		outcomeCh <- classifyExit(cmd.Wait())
		close(e.exited)
	}()

	timer := time.NewTimer(settleWindow)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		// Not yet tracked in s.entries (only the timer/sidecar branch below adds it) — killEntry
		// operates on e directly regardless, and F1's own bound on it means this returns promptly
		// rather than blocking for however long the script would otherwise have run.
		s.killEntry(connectionID, e)
		return Start{}, ctx.Err()

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
// the real exit (bounded — F1, see below), and removes the entry. Marking killing=true first
// ensures awaitExit's own exit routing stays silent for this kill.
//
// P21 round 3 finding 6: an entry can reach here already dead — awaitExit deliberately leaves a
// sidecar that exited on its own (before Arm was ever called) sitting in s.entries for Arm to
// consume, and Arm may never come (a connect that fails after the script settled, a connection
// removed before arming). e.pid has already been reaped by cmd.Wait() in that case, and on a busy
// machine a reaped pid can be recycled as the leader of an *unrelated* process group by the time
// Stop/StopAll reaches it here — signalling -e.pid unconditionally would SIGTERM/SIGKILL whatever
// that pid now is, not this sidecar. e.exited is closed exactly once cmd.Wait() returns, so
// checking it first (and re-checking right before the escalation fires, racing the same reap)
// skips the whole kill/escalate dance for an entry that is already gone.
//
// F1 (P108 Part 3): -e.pid (a process-group signal) never reaches a descendant that left the
// group (setsid, daemon(3)), so SIGKILL is no guarantee the tracked process itself ever dies —
// waiting on e.exited unconditionally could block Disconnect/Remove/quit forever. Give up
// killGrace after the SIGKILL escalation fires (Start's own cmd.WaitDelay already bounds the I/O
// half of Wait(); this bounds the case where the process itself never receives or heeds a signal)
// and log rather than block further — the entry is still removed from tracking either way.
func (s *Supervisor) killEntry(connectionID string, e *entry) {
	e.mu.Lock()
	e.killing = true
	e.mu.Unlock()

	select {
	case <-e.exited:
		// Already dead (or dies in the instant before the signal below goes out — an
		// unavoidable, narrower race a non-atomic check-then-kill can't fully close). ESRCH from
		// a stale pid is otherwise indistinguishable from "no such process" for an unrelated
		// pid that never existed, so there is nothing further to signal here.
	default:
		_ = killSignal(-e.pid, syscall.SIGTERM)

		giveUp := make(chan struct{})
		escalate := time.AfterFunc(killGrace, func() {
			select {
			case <-e.exited:
				return // reaped between the SIGTERM above and this timer firing.
			default:
			}
			_ = killSignal(-e.pid, syscall.SIGKILL)
			time.AfterFunc(killGrace, func() { close(giveUp) })
		})

		select {
		case <-e.exited:
		case <-giveUp:
			slog.Warn(fmt.Sprintf("preconnect[%s] pid %d did not exit within %s of SIGKILL, giving up", connectionID, e.pid, killGrace), "scope", "preconnect")
		}
		escalate.Stop()
	}

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
	const fallback = "/usr/local/bin:/opt/homebrew/bin"
	out := make([]string, 0, len(env)+1)
	found := false
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			// A leading empty PATH element is `.` to /bin/sh — never emit one, whether the
			// existing PATH= value is empty or missing entirely: cmd.Dir is the user's home
			// directory, so a leading `.` there would run an arbitrary file dropped in ~ (named
			// e.g. kubectl, aws, psql) in preference to nothing.
			if existing := strings.TrimPrefix(kv, "PATH="); existing != "" {
				out = append(out, kv+":"+fallback)
			} else {
				out = append(out, "PATH="+fallback)
			}
			found = true
			continue
		}
		out = append(out, kv)
	}
	if !found {
		out = append(out, "PATH="+fallback)
	}
	return out
}
