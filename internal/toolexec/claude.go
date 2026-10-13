package toolexec

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// ErrClaudeMissing means no `claude` CLI was found anywhere a launch could reach it.
var ErrClaudeMissing = errors.New("claude CLI not found")

const shellProbeTimeout = 5 * time.Second

// ClaudeDeps are ResolveClaude's seams; the zero value uses the real process environment.
type ClaudeDeps struct {
	// Bin, when absolute, is the only path considered (a test points it at a fake).
	Bin      string
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	Getenv   func(string) string
	// RunShell runs script under the shell as a login, interactive shell and returns its stdout.
	RunShell func(ctx context.Context, shell, script string) ([]byte, error)
}

func (d ClaudeDeps) withDefaults() ClaudeDeps {
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
			return RunIO(ctx, shell, []string{"-l", "-i", "-c", script}, "", os.Environ(), nil)
		}
	}
	return d
}

// ResolveClaude finds the `claude` CLI: PATH and the well-known install paths first, then the
// user's login shell, because a launch runs through that shell and a GUI app's own PATH can differ
// from it. probed lists every place considered. A miss returns ErrClaudeMissing.
func ResolveClaude(ctx context.Context, deps ClaudeDeps) (path string, probed []string, err error) {
	deps = deps.withDefaults()
	if filepath.IsAbs(deps.Bin) {
		if IsExecutable(deps.Stat, deps.Bin) {
			return deps.Bin, []string{deps.Bin}, nil
		}
		return "", []string{deps.Bin}, ErrClaudeMissing
	}
	path, probed, found := Locate(deps.LookPath, deps.Stat, "claude", ClaudeCandidates())
	if found {
		return path, probed, nil
	}
	shell := deps.Getenv("SHELL")
	if !filepath.IsAbs(shell) || !IsExecutable(deps.Stat, shell) {
		return "", probed, ErrClaudeMissing
	}
	probed = append(probed, "claude (in "+shell+" login shell)")
	sctx, cancel := context.WithTimeout(ctx, shellProbeTimeout)
	defer cancel()
	out, _ := deps.RunShell(sctx, shell, "command -v claude")
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if filepath.IsAbs(line) && IsExecutable(deps.Stat, line) {
			return line, probed, nil
		}
	}
	return "", probed, ErrClaudeMissing
}

// ClaudeMissing is the user-facing error for a failed ResolveClaude.
func ClaudeMissing(probed []string) *ipcerr.Error {
	return ipcerr.T(ipcerr.CodeNotFound, "backend.core.claude.missing.body", map[string]string{"probed": strings.Join(probed, ", ")})
}

// RequireClaude resolves the CLI and returns the Kira error when it is missing.
func RequireClaude(ctx context.Context, deps ClaudeDeps) (string, error) {
	path, probed, err := ResolveClaude(ctx, deps)
	if err != nil {
		if errors.Is(err, ErrClaudeMissing) {
			return "", ClaudeMissing(probed)
		}
		return "", err
	}
	return path, nil
}
