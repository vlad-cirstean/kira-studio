// Package agentsandbox confines headless workflow agents with a Kira-generated macOS Seatbelt
// profile. It builds the policy, renders the SBPL text, enforces it on darwin and only declares it
// elsewhere.
package agentsandbox

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// Access is how much a run may write.
type Access string

const (
	AccessWrite Access = "write"
	AccessRead  Access = "read"
	AccessOff   Access = "off"
)

// GeneratorVersion tags every profile header.
const GeneratorVersion = "kira-sbpl/1"

// Policy is what one run may do, resolved to real paths.
type Policy struct {
	RunID  string
	Access Access
	// Write are the delegated worktrees (write access); a rebase run lists its whole stack.
	Write []string
	// RunDir is the cwd; Write[0] for worktree runs.
	RunDir string
	// Read are the step's read folders plus the worktree for read access.
	Read []string
	// Allow are the step's extra read-write paths.
	Allow    []string
	Network  bool
	Keychain bool
	// Git is one layout per worktree that is a git checkout.
	Git []GitLayout
	// Scratch is TMPDIR's parent: <AgentDir>/sandbox/<runID>.
	Scratch string
	// Cache is the shared build-cache root, <AgentDir>/sandbox-cache.
	Cache string
	// Ports are the loopback ports the run reaches: the kira-ade MCP server, the allowlist proxy.
	Ports []int
	// Branch maps a worktree to the branch it may advance.
	Branch map[string]string
}

// GitLayout locates a worktree's git directories. GitDir equals CommonDir for a main worktree.
type GitLayout struct {
	Worktree, GitDir, CommonDir string
}

// Linked reports whether the worktree has its own gitdir apart from the common one.
func (g GitLayout) Linked() bool { return g.GitDir != g.CommonDir }

// Input is what the caller knows before paths are resolved.
type Input struct {
	RunID  string
	Access Access
	// Worktrees are the delegated worktrees: written with write access, read with read access.
	Worktrees []string
	// ReadWorktrees are always read-only (a smart step reads the task worktree while it writes its
	// own script folder).
	ReadWorktrees []string
	// RunDir is the cwd; empty means Worktrees[0].
	RunDir      string
	Read, Allow []string
	Network     bool
	Keychain    bool
	Scratch     string
	Cache       string
	Ports       []int
	Branch      map[string]string
}

// Denial is one blocked operation.
type Denial struct {
	At      time.Time `json:"at"`
	Op      string    `json:"op"`
	Target  string    `json:"target"`
	Process string    `json:"process"`
	// Count is how often this (op, target) occurred in the run so far; 1 marks the first.
	Count int `json:"count"`
}

// ExpandHome turns "~/x" into home/x; any other path must already be absolute.
func ExpandHome(p, home string) (string, error) {
	switch {
	case p == "~":
		return home, nil
	case strings.HasPrefix(p, "~/"):
		return filepath.Join(home, p[2:]), nil
	case filepath.IsAbs(p):
		return filepath.Clean(p), nil
	}
	return "", fmt.Errorf("path %q is not absolute", p)
}

// ResolvePolicy expands "~/", canonicalizes with EvalSymlinks (Seatbelt matches real paths: /var is
// /private/var) and probes each worktree's git layout. A missing read or allow path is skipped with
// a note; a missing worktree is an error. It creates Scratch/tmp and Cache.
func ResolvePolicy(in Input, rt Runtime) (Policy, []string, error) {
	if in.Access != AccessWrite && in.Access != AccessRead {
		return Policy{}, nil, fmt.Errorf("agentsandbox: no policy for access %q", in.Access)
	}
	if len(in.Worktrees) == 0 {
		return Policy{}, nil, errors.New("agentsandbox: a policy needs a worktree")
	}
	p := Policy{RunID: in.RunID, Access: in.Access, Network: in.Network, Keychain: in.Keychain, Ports: in.Ports}
	var notes []string
	real := func(path string) (string, error) {
		abs, err := ExpandHome(path, rt.Home)
		if err != nil {
			return "", err
		}
		return filepath.EvalSymlinks(abs)
	}
	var wts []string
	for _, w := range in.Worktrees {
		r, err := real(w)
		if err != nil {
			return Policy{}, nil, fmt.Errorf("agentsandbox: worktree %s: %w", w, err)
		}
		wts = appendUnique(wts, r)
	}
	var ro []string
	for _, w := range in.ReadWorktrees {
		r, err := real(w)
		if err != nil {
			return Policy{}, nil, fmt.Errorf("agentsandbox: worktree %s: %w", w, err)
		}
		ro = appendUnique(ro, r)
	}
	if in.Access == AccessWrite {
		p.Write = wts
	} else {
		p.Read = appendUnique(p.Read, wts...)
	}
	p.Read = appendUnique(p.Read, ro...)
	p.RunDir = wts[0]
	if in.RunDir != "" {
		r, err := real(in.RunDir)
		if err != nil {
			return Policy{}, nil, fmt.Errorf("agentsandbox: run dir %s: %w", in.RunDir, err)
		}
		p.RunDir = r
	}
	keychains := filepath.Join(rt.Home, "Library", "Keychains")
	var denied error
	extra := func(list []string) []string {
		var out []string
		for _, e := range list {
			r, err := real(e)
			if err != nil {
				notes = append(notes, i18n.T("backend.space.ade.sandbox.pathMissing.body", map[string]string{"path": e}))
				continue
			}
			if r == keychains || strings.HasPrefix(r, keychains+string(filepath.Separator)) {
				denied = fmt.Errorf("agentsandbox: path %q is not allowed", e)
				continue
			}
			out = appendUnique(out, r)
		}
		return out
	}
	p.Read = appendUnique(p.Read, extra(in.Read)...)
	p.Allow = extra(in.Allow)
	if denied != nil {
		return Policy{}, nil, denied
	}
	for _, d := range []struct {
		src string
		dst *string
		sub string
	}{{in.Scratch, &p.Scratch, "tmp"}, {in.Cache, &p.Cache, ""}} {
		if d.src == "" {
			return Policy{}, nil, errors.New("agentsandbox: scratch and cache directories are required")
		}
		if err := os.MkdirAll(filepath.Join(d.src, d.sub), 0o700); err != nil {
			return Policy{}, nil, err
		}
		r, err := filepath.EvalSymlinks(d.src)
		if err != nil {
			return Policy{}, nil, err
		}
		*d.dst = r
	}
	if len(in.Branch) > 0 {
		p.Branch = map[string]string{}
		for w, b := range in.Branch {
			if r, err := real(w); err == nil && b != "" {
				p.Branch[r] = b
			}
		}
	}
	for _, w := range append(append([]string{}, wts...), ro...) {
		g, ok, err := ProbeGit(w)
		if err != nil {
			return Policy{}, nil, err
		}
		if ok {
			p.Git = append(p.Git, g)
		}
	}
	return p, notes, nil
}

func appendUnique(list []string, add ...string) []string {
	for _, a := range add {
		dup := false
		for _, l := range list {
			if l == a {
				dup = true
				break
			}
		}
		if !dup {
			list = append(list, a)
		}
	}
	return list
}

// ProbeGit reads a worktree's .git: a file points at the linked gitdir, a directory marks a main
// worktree. ok is false for a folder that is no checkout.
func ProbeGit(worktree string) (GitLayout, bool, error) {
	dotGit := filepath.Join(worktree, ".git")
	fi, err := os.Lstat(dotGit)
	if errors.Is(err, os.ErrNotExist) {
		return GitLayout{}, false, nil
	}
	if err != nil {
		return GitLayout{}, false, err
	}
	if fi.IsDir() {
		gd, err := filepath.EvalSymlinks(dotGit)
		if err != nil {
			return GitLayout{}, false, err
		}
		return GitLayout{Worktree: worktree, GitDir: gd, CommonDir: gd}, true, nil
	}
	raw, err := os.ReadFile(dotGit)
	if err != nil {
		return GitLayout{}, false, err
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(raw)), "\n")
	target, found := strings.CutPrefix(line, "gitdir:")
	if !found {
		return GitLayout{}, false, fmt.Errorf("agentsandbox: %s is not a gitdir pointer", dotGit)
	}
	target = strings.TrimSpace(target)
	if !filepath.IsAbs(target) {
		target = filepath.Join(worktree, target)
	}
	gd, err := filepath.EvalSymlinks(target)
	if err != nil {
		return GitLayout{}, false, err
	}
	common := gd
	if cd, err := os.ReadFile(filepath.Join(gd, "commondir")); err == nil {
		c := strings.TrimSpace(string(cd))
		if !filepath.IsAbs(c) {
			c = filepath.Join(gd, c)
		}
		if common, err = filepath.EvalSymlinks(c); err != nil {
			return GitLayout{}, false, err
		}
	}
	return GitLayout{Worktree: worktree, GitDir: gd, CommonDir: common}, true, nil
}
