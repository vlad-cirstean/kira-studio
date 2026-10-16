// Package sandboxtest is a flow-test Enforcer: it renders the real profile and wraps claude in a
// shim that skips sandbox-exec, so flow tests see the flags, env and wrapper without Seatbelt.
package sandboxtest

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/google/renameio/v2"
	"github.com/kirathecat/kira-studio/internal/agentsandbox"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
)

// Fake implements agentsandbox.Enforcer.
type Fake struct {
	// Dir holds the shim.
	Dir string
	// NotEnforced mimics Linux: Prepare returns flags and env but no wrapper.
	NotEnforced bool
	// PrepareErr makes Prepare fail.
	PrepareErr error

	mu       sync.Mutex
	policies []agentsandbox.Policy
	watchers map[string]func(agentsandbox.Denial)
	counts   map[string]map[[2]string]int
	pids     map[string]int
}

func (f *Fake) Support() agentsandbox.Support {
	if f.NotEnforced {
		return agentsandbox.Support{Reason: agentsandbox.NotEnforcedKey}
	}
	return agentsandbox.Support{Enforced: true}
}

func (f *Fake) Prepare(p agentsandbox.Policy, rt agentsandbox.Runtime) (agentsandbox.Prepared, error) {
	if f.PrepareErr != nil {
		return agentsandbox.Prepared{}, f.PrepareErr
	}
	f.mu.Lock()
	f.policies = append(f.policies, p)
	f.mu.Unlock()
	pr := agentsandbox.Prepared{Profile: agentsandbox.Profile(p, rt), Env: agentsandbox.Env(p, "")}
	pr.AddDirs, pr.Disallowed = agentsandbox.Flags(p)
	if f.NotEnforced {
		return pr, nil
	}
	path := filepath.Join(p.Scratch, "profile.sb")
	if err := renameio.WriteFile(path, []byte(pr.Profile), 0o600); err != nil {
		return agentsandbox.Prepared{}, err
	}
	shim := filepath.Join(f.Dir, "sandbox-exec-shim")
	if err := renameio.WriteFile(shim, []byte("#!/bin/sh\nshift 2\nexec \"$@\"\n"), 0o755); err != nil {
		return agentsandbox.Prepared{}, err
	}
	if err := os.Chmod(shim, 0o755); err != nil {
		return agentsandbox.Prepared{}, err
	}
	pr.ProfilePath = path
	pr.Exec = &claudeheadless.SandboxExec{Bin: shim, Profile: path, Env: pr.Env, Unset: []string{"SSH_AUTH_SOCK"}}
	return pr, nil
}

// Release is a no-op: the fake registers nothing per run.
func (f *Fake) Release(string) {}

func (f *Fake) Watch(pid int, runID string, on func(agentsandbox.Denial)) func() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.watchers == nil {
		f.watchers, f.counts, f.pids = map[string]func(agentsandbox.Denial){}, map[string]map[[2]string]int{}, map[string]int{}
	}
	f.watchers[runID], f.counts[runID], f.pids[runID] = on, map[[2]string]int{}, pid
	return func() {
		f.mu.Lock()
		defer f.mu.Unlock()
		delete(f.watchers, runID)
	}
}

// Inject reports a denial on a watched run; it reports false when the run is not watched.
func (f *Fake) Inject(runID string, d agentsandbox.Denial) bool {
	f.mu.Lock()
	on := f.watchers[runID]
	if on == nil {
		f.mu.Unlock()
		return false
	}
	key := [2]string{d.Op, d.Target}
	f.counts[runID][key]++
	d.Count = f.counts[runID][key]
	f.mu.Unlock()
	on(d)
	return true
}

// WatchedRun returns the id of the single watched run, or "".
func (f *Fake) WatchedRun() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id := range f.watchers {
		return id
	}
	return ""
}

// Policies are the policies Prepare saw, in order.
func (f *Fake) Policies() []agentsandbox.Policy {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]agentsandbox.Policy(nil), f.policies...)
}
