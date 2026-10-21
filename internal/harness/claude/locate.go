package claude

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// ErrMissing means no `claude` CLI was found anywhere a launch could reach it.
var ErrMissing = errors.New("claude CLI not found")

const shellProbeTimeout = 5 * time.Second

// Deps are Resolve's seams; the zero value uses the real process environment.
type Deps struct {
	// Bin, when absolute, is the only path considered (a test points it at a fake).
	Bin      string
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	Getenv   func(string) string
	// RunShell runs script under the shell as a login, interactive shell and returns its stdout.
	RunShell func(ctx context.Context, shell, script string) ([]byte, error)
}

func (d Deps) withDefaults() Deps {
	if d.LookPath == nil {
		d.LookPath = exec.LookPath
	}
	if d.Stat == nil {
		d.Stat = os.Stat
	}
	if d.Getenv == nil {
		d.Getenv = os.Getenv
	}
	if d.RunShell == nil {
		d.RunShell = func(ctx context.Context, shell, script string) ([]byte, error) {
			return toolexec.RunIO(ctx, shell, []string{"-l", "-i", "-c", script}, "", os.Environ(), nil)
		}
	}
	return d
}

// Resolve finds the `claude` CLI: PATH and the well-known install paths first, then the user's
// login shell, because a launch runs through that shell and a GUI app's own PATH can differ from
// it. probed lists every place considered. A miss returns ErrMissing.
func Resolve(ctx context.Context, deps Deps) (path string, probed []string, err error) {
	deps = deps.withDefaults()
	if filepath.IsAbs(deps.Bin) {
		if toolexec.IsExecutable(deps.Stat, deps.Bin) {
			return deps.Bin, []string{deps.Bin}, nil
		}
		return "", []string{deps.Bin}, ErrMissing
	}
	path, probed, found := toolexec.Locate(deps.LookPath, deps.Stat, "claude", Candidates())
	if found {
		return path, probed, nil
	}
	shell := deps.Getenv("SHELL")
	if !filepath.IsAbs(shell) || !toolexec.IsExecutable(deps.Stat, shell) {
		return "", probed, ErrMissing
	}
	probed = append(probed, "claude (in "+shell+" login shell)")
	sctx, cancel := context.WithTimeout(ctx, shellProbeTimeout)
	defer cancel()
	out, _ := deps.RunShell(sctx, shell, "command -v claude")
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if filepath.IsAbs(line) && toolexec.IsExecutable(deps.Stat, line) {
			return line, probed, nil
		}
	}
	return "", probed, ErrMissing
}

// Missing is the user-facing error for a failed Resolve.
func Missing(probed []string) *ipcerr.Error {
	return ipcerr.T(ipcerr.CodeNotFound, "backend.core.agent.missing.body", map[string]string{"product": "Claude Code", "probed": strings.Join(probed, ", ")})
}

// Require resolves the CLI and returns the Kira error when it is missing.
func Require(ctx context.Context, deps Deps) (string, error) {
	path, probed, err := Resolve(ctx, deps)
	if err != nil {
		if errors.Is(err, ErrMissing) {
			return "", Missing(probed)
		}
		return "", err
	}
	return path, nil
}

var systemPaths = []string{"/usr/local/bin/claude", "/opt/homebrew/bin/claude"}

// SetSystemPaths replaces the system-wide candidates and returns the restore func. A flow test
// passes none so the host's own install cannot change its outcome.
func SetSystemPaths(paths ...string) (restore func()) {
	prev := systemPaths
	systemPaths = paths
	return func() { systemPaths = prev }
}

// Candidates is the probe order after PATH for the `claude` CLI: the well-known absolute paths a
// Finder-launched app's launchd-inherited PATH (/usr/bin:/bin:/usr/sbin:/sbin) never includes.
func Candidates() []string {
	candidates := append([]string(nil), systemPaths...)
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append([]string{
			filepath.Join(home, ".claude", "local", "claude"),
			filepath.Join(home, ".local", "bin", "claude"),
		}, candidates...)
	}
	return candidates
}

// Locate resolves the claude CLI the way a launch does. An absolute bin is the only path tried.
func (*Provider) Locate(ctx context.Context, bin string) (string, error) {
	return Require(ctx, Deps{Bin: bin})
}

// Available is the quick probe without the login-shell fallback.
func (p *Provider) Available() error {
	if _, _, found := p.find(); !found {
		return errNotFound
	}
	return nil
}

func (p *Provider) find() (string, []string, bool) {
	lookPath, stat := p.lookPath, p.stat
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	if stat == nil {
		stat = os.Stat
	}
	return toolexec.Locate(lookPath, stat, "claude", Candidates())
}
