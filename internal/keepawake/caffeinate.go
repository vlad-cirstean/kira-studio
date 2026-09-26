package keepawake

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
)

// caffeinateFallbackPath is used only when LookPath cannot resolve the name — caffeinate ships at
// this fixed location on every macOS (internal/startupfail's own osascriptFallbackPath note,
// alert.go:15-19).
const caffeinateFallbackPath = "/usr/bin/caffeinate"

// caffeinateArgv is the whole command line, as a pure function so a golden-argv test can assert it
// byte for byte (internal/startupfail's TestAlertArgvGolden precedent):
//
//	-i   prevent idle sleep
//	-s   prevent system sleep (macOS honours this on AC power only — see ARCHITECTURE.md)
//	-w   exit when this app's own process does, so a crash (where no teardown runs) cannot orphan
//	     an assertion that keeps the machine awake forever
func caffeinateArgv(pid int) []string {
	return []string{"-i", "-s", "-w", strconv.Itoa(pid)}
}

// caffeinateDriver is the darwin Driver: spawns/kills `caffeinate -i -s -w <our pid>` as a child
// process. No cgo, no direct IOPMAssertionCreateWithName call — caffeinate is Apple's own supported
// CLI wrapping the identical IOKit API.
type caffeinateDriver struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	expected bool
	onLost   func(error)

	// lookPath is a package-private seam (internal/startupfail/exec.go's realLookPath pattern) —
	// caffeinate_test.go's lifecycle test points it at an injected test binary instead of the real
	// caffeinate. Not an exported option: nothing outside this package may choose what binary gets
	// spawned.
	lookPath func(string) (string, error)
}

func newCaffeinateDriver() *caffeinateDriver {
	return &caffeinateDriver{lookPath: exec.LookPath}
}

// OnLost implements the Controller's own lossReporter capability (keepawake.go) — registered once,
// at construction, from Controller.New.
func (d *caffeinateDriver) OnLost(f func(error)) {
	d.mu.Lock()
	d.onLost = f
	d.mu.Unlock()
}

// Acquire resolves the binary fresh on every call (so a PATH change between launches is picked
// up), spawns it argv-only with no shell (the only variable in the line is our own pid — no
// renderer-controlled string anywhere in it), and hands the finished process to its own reaper
// goroutine rather than waiting here.
func (d *caffeinateDriver) Acquire() error {
	path, err := d.lookPath("caffeinate")
	if err != nil {
		path = caffeinateFallbackPath
	}

	cmd := exec.Command(path, caffeinateArgv(os.Getpid())...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("keepawake: start caffeinate: %w", err)
	}

	d.mu.Lock()
	d.cmd = cmd
	d.expected = false
	d.mu.Unlock()

	go d.reap(cmd)
	return nil
}

// reap is Acquire's own goroutine, one per spawn: it blocks on Wait() (deliberately never called
// under Controller's own lock, §1.3) and, if this exit was not requested by Release, reports it
// through onLost — Controller's self-heal path (§1.4).
//
// F12: whether to report is decided under the same `d.cmd == cmd` check that clears d.cmd, not
// read as a bare driver-wide d.expected — Rearm (Release then Acquire back to back) can have the
// new Acquire already reset d.expected to false for the NEW child before this reaper, still
// unwinding the OLD child's intentional kill, ever gets the lock. Reading d.expected outside this
// identity check would then see the wrong child's flag and report a real assertion loss for a
// death this driver itself caused. Once cmd has been superseded (d.cmd != cmd), this reaper has
// nothing to report and nothing to clear — whichever reaper does own the current d.cmd handles it.
func (d *caffeinateDriver) reap(cmd *exec.Cmd) {
	err := cmd.Wait()

	d.mu.Lock()
	var report bool
	if d.cmd == cmd {
		report = !d.expected
		d.cmd = nil
	}
	onLost := d.onLost
	d.mu.Unlock()

	if report && onLost != nil {
		onLost(err)
	}
}

// Release marks the current child expected-to-exit and kills it — idempotent, safe when nothing is
// running. The reaper goroutine still does the actual Wait().
func (d *caffeinateDriver) Release() {
	d.mu.Lock()
	cmd := d.cmd
	d.expected = true
	d.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}

func (d *caffeinateDriver) Supported() bool { return true }
