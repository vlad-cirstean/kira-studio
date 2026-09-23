// Package mcpinstall registers the DB MCP server's embedded instance with Claude Code's own CLI
// (docs/v1.7/plans/M1-db-mcp-server-core.md) — the one client this app installs for. Argv-only,
// never a shell, never writes another program's config file directly — the same discipline
// internal/gitvsix already applies to its own `code` spawn, though the two packages share no code
// (unrelated problems, no probe order worth factoring out).
package mcpinstall

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// spawnTimeout is this package's own bound on the one spawn Install makes (`claude mcp add`) — a
// local, fast operation with no network round trip of its own, so a wedged child is the only
// failure mode a bound needs to guard against.
const spawnTimeout = 30 * time.Second

// Deps are the three independent seams this package needs: finding `claude`, checking a candidate
// exists, and spawning one. Function fields rather than an interface — gitvsix.Deps' own
// precedent — so a test can inject each independently. A zero-value field falls back to the real
// OS implementation (New).
type Deps struct {
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	Run      func(ctx context.Context, path string, args []string) error
}

// Installer is this package's whole surface, constructed once (main.go) and shared for the app's
// life — every call re-resolves `claude` fresh, so an install that happens after Status was last
// read (installing the CLI after the pane rendered) still works on the next click.
type Installer struct {
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
	run      func(ctx context.Context, path string, args []string) error
}

// New constructs an Installer over d, substituting the real OS implementation for any zero-value
// field (gitclient.NewRunner/gitvsix.New's own shared shape).
func New(d Deps) *Installer {
	i := &Installer{lookPath: d.LookPath, stat: d.Stat, run: d.Run}
	if i.lookPath == nil {
		i.lookPath = realLookPath
	}
	if i.stat == nil {
		i.stat = realStat
	}
	if i.run == nil {
		i.run = toolexec.Run
	}
	return i
}

// Status is the pane's own pre-click render — advisory only: Install re-resolves everything
// itself, so a `claude` installed after Status was last read still works on the next click.
type Status struct {
	// ClaudePath is "" when `claude` was not found at any probed location.
	ClaudePath string
	// Probed lists every path considered, in probe order — always populated (gitvsix.Status's own
	// reasoning: a miss can be explained, not just reported).
	Probed []string
}

// Result is Install's own outcome — see the Outcome* constants below. Install never returns a Go
// error (connections.Service.Reveal / gitvsix.Installer.Install's precedent): a registration
// attempt is a value the pane renders, not a failure the caller must handle specially.
type Result struct {
	Outcome string
	// Detail is a bounded, single-line reason on installFailed — never the token, never a child's
	// stderr verbatim beyond what exec.go's firstLineBounded already truncated it to.
	Detail string
	Probed []string
}

const (
	// OutcomeInstalled: `claude` found, `mcp add` exited 0.
	OutcomeInstalled = "installed"
	// OutcomeNotFound: `claude` not found anywhere in the probe order — not a failure state (§7.2):
	// the command is already on screen to copy, and needs no fallback of its own.
	OutcomeNotFound = "notFound"
	// OutcomeInstallFailed: `claude` was found but exited non-zero (e.g. a name collision) or could
	// not be spawned.
	OutcomeInstallFailed = "installFailed"
)

// claudeCandidates is §7.2's own probe order after the PATH step (locateClaude runs LookPath
// first): the well-known absolute paths a Finder-launched app's launchd-inherited PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) never includes — the same launchd-PATH problem gitvsix already
// documented for `code`.
func claudeCandidates() []string {
	candidates := []string{"/usr/local/bin/claude", "/opt/homebrew/bin/claude"}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append([]string{
			filepath.Join(home, ".claude", "local", "claude"),
			filepath.Join(home, ".local", "bin", "claude"),
		}, candidates...)
	}
	return candidates
}

// locateClaude mirrors gitvsix's own darwinLocator shape: PATH first, then every absolute
// candidate in order, every path considered recorded in probed regardless of outcome.
func (i *Installer) locateClaude() (path string, probed []string, found bool) {
	return toolexec.Locate(i.lookPath, i.stat, "claude", claudeCandidates())
}

// Status is the pane's own pre-click read.
func (i *Installer) Status() Status {
	path, probed, _ := i.locateClaude()
	return Status{ClaudePath: path, Probed: probed}
}

// Command renders §7.2's exact display command for name/url/token — the same argv Install spawns,
// shown with shell-style quoting for copy-paste rather than passed through a shell.
func Command(name, url, token string) string {
	return "claude mcp add --transport http --scope user " + name + " " + url +
		" --header \"Authorization: Bearer " + token + "\""
}

func detailFor(ctx context.Context, err error) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timed out"
	}
	var runErr *toolexec.ExecError
	if errors.As(err, &runErr) {
		return runErr.Error()
	}
	return err.Error()
}

// Install re-resolves `claude` fresh and never returns a Go error — every outcome is a named
// Result value (§7.2's own "Install button" spec).
func (i *Installer) Install(ctx context.Context, name, url, token string) Result {
	claudePath, probed, found := i.locateClaude()
	if !found {
		return Result{Outcome: OutcomeNotFound, Probed: probed}
	}

	spawnCtx, cancel := context.WithTimeout(ctx, spawnTimeout)
	defer cancel()
	args := []string{
		"mcp", "add", "--transport", "http", "--scope", "user", name, url,
		"--header", "Authorization: Bearer " + token,
	}
	if err := i.run(spawnCtx, claudePath, args); err != nil {
		return Result{Outcome: OutcomeInstallFailed, Detail: detailFor(spawnCtx, err), Probed: probed}
	}
	return Result{Outcome: OutcomeInstalled, Probed: probed}
}
