// Package preconnect is the Go analogue of src/main/preconnect.ts (P11): it owns every child
// process the app spawns on the user's behalf, running a pre-connect shell command before an
// adapter connects and, once armed, watching a long-lived sidecar for an unexpected exit.
package preconnect

import (
	"context"
	"errors"
	"fmt"
	"io"
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
	// stderrDrain bounds how long Start waits for buffered stderr after the leader exits; a
	// group member still holding the pipe would otherwise stall the read forever.
	stderrDrain = 200 * time.Millisecond
	// groupPoll is how often a reaped leader's process group is probed for surviving members.
	groupPoll = 50 * time.Millisecond
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
	// groupGone closes once the leader has exited and no member of its process group remains.
	// A pgid cannot be recycled while a member lives, so signalling -pid is safe until then.
	groupGone chan struct{}

	stderrR    *os.File
	readerDone chan struct{} // closed when the stderr reader has stopped

	tailMu sync.Mutex
	tail   tailTracker

	mu      sync.Mutex
	armed   bool
	killing bool
	dead    *Exit // set if the process exited before Arm consumed it
}

// stderrWriter feeds the stderr pipe's bytes into an entry's tail tracker.
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

	e := &entry{exited: make(chan struct{}), groupGone: make(chan struct{}), readerDone: make(chan struct{})}

	// Own pipe, not an io.Writer on cmd.Stderr: with an *os.File the stdlib spawns no copy
	// goroutine, so cmd.Wait() returns when the shell itself exits (real exit code, no wait on a
	// background child that inherited the pipe).
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		return Start{}, fmt.Errorf("Pre-connect script could not start: %w", err)
	}

	cmd := exec.Command("/bin/sh", "-c", command)
	cmd.Dir = dir
	cmd.Stdout = nil // D8: /dev/null, not a pipe nobody reads — deliberately stricter than the TS original.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = withAugmentedPath(os.Environ())
	cmd.Stderr = stderrW

	if err := cmd.Start(); err != nil {
		_ = stderrW.Close()
		_ = stderrR.Close()
		slog.Error(fmt.Sprintf("preconnect[%s] failed to spawn: %s", connectionID, err), "scope", "preconnect")
		return Start{}, fmt.Errorf("Pre-connect script could not start: %s", err)
	}
	_ = stderrW.Close()
	e.pid = cmd.Process.Pid

	e.stderrR = stderrR
	go func() {
		defer close(e.readerDone)
		defer stderrR.Close()
		_, _ = io.Copy(stderrWriter{e: e}, stderrR)
	}()

	outcomeCh := make(chan outcome, 1)
	go func() {
		out := classifyExit(cmd.Wait())
		if syscall.Kill(-e.pid, 0) == syscall.ESRCH {
			close(e.groupGone)
		} else {
			go e.watchGroup()
		}
		outcomeCh <- out
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
			// A background child left in the group (`kubectl port-forward ... & sleep 1`) stays
			// tracked so Stop/StopAll still reach it.
			if !e.groupDead() {
				s.mu.Lock()
				s.entries[connectionID] = e
				s.mu.Unlock()
			}
			return Start{Kind: KindOneShot}, nil
		}
		e.drainStderr()
		s.killEntry(connectionID, e)
		return Start{}, fmt.Errorf("Pre-connect script failed %s", exitDetail(out, e.lastStderr()))
	}
}

// awaitExit runs for the lifetime of a settled sidecar entry: it blocks for the process's real
// exit and then routes it via the same three-way killing/armed/dead test preconnect.ts:186-203
// uses.
func (s *Supervisor) awaitExit(connectionID string, e *entry, outcomeCh chan outcome) {
	out := <-outcomeCh
	e.drainStderr()

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
		// The leader is gone, so the connection is down; reap any group member it left behind.
		s.killEntry(connectionID, e)
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
	go s.killEntry(connectionID, e)
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
// the group to empty (bounded), and removes the entry. Marking killing=true first keeps
// awaitExit's own exit routing silent for this kill.
//
// P21 round 3 finding 6: once the leader is reaped its pid can be recycled as an unrelated group's
// leader, so signalling -e.pid is only safe while a group member still lives. groupGone closes
// the moment none does (checked right after the reap, then polled), and a closed groupGone skips
// every signal. A surviving member of a reaped leader's group (a one-shot script's background
// child) is still signalled, since its pgid stays reserved.
//
// F1 (P108 Part 3): -e.pid never reaches a descendant that left the group (setsid, daemon(3)), so
// give up killGrace after the SIGKILL escalation fires and log rather than block Disconnect,
// Remove or quit forever. The entry is removed either way.
func (s *Supervisor) killEntry(connectionID string, e *entry) {
	e.mu.Lock()
	e.killing = true
	e.mu.Unlock()

	if !e.groupDead() {
		_ = killSignal(-e.pid, syscall.SIGTERM)

		giveUp := make(chan struct{})
		escalate := time.AfterFunc(killGrace, func() {
			if e.groupDead() {
				return // emptied between the SIGTERM above and this timer firing.
			}
			_ = killSignal(-e.pid, syscall.SIGKILL)
			time.AfterFunc(killGrace, func() { close(giveUp) })
		})

		select {
		case <-e.groupGone:
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

// drainStderr picks up stderr already buffered once the leader has exited, bounded in case a
// surviving group member keeps the pipe's write end open.
func (e *entry) drainStderr() {
	_ = e.stderrR.SetReadDeadline(time.Now().Add(stderrDrain))
	<-e.readerDone
}

func (e *entry) groupDead() bool {
	select {
	case <-e.groupGone:
		return true
	default:
		return false
	}
}

// watchGroup closes groupGone once the reaped leader's process group has no members left.
func (e *entry) watchGroup() {
	for syscall.Kill(-e.pid, 0) != syscall.ESRCH {
		time.Sleep(groupPoll)
	}
	close(e.groupGone)
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
