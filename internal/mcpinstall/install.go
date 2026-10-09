// Package mcpinstall locates Claude Code's CLI and removes MCP registrations through it. Kira
// never registers servers in the user's Claude Code config: sessions Kira Space starts get them
// per launch (internal/claudecfg). Every spawn is argv-only, never a shell, and the package never
// writes another program's config file directly. Command is the one exception: it renders shell
// syntax (`;`, redirection) purely as copy-paste TEXT for a user to run themselves, never executed
// by this package.
package mcpinstall

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// spawnTimeout bounds the one spawn Remove makes: a local, fast operation, so a wedged child is
// the only failure a bound guards against.
const spawnTimeout = 30 * time.Second

// Deps are the three independent seams this package needs: finding `claude`, checking a candidate
// exists, and spawning one. Function fields rather than an interface, so a test can inject each
// independently. A zero-value field falls back to the real OS implementation (New).
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
// field.
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

// Status is advisory: Remove re-resolves `claude` itself, so a CLI installed after Status was last
// read still works.
type Status struct {
	// ClaudePath is "" when `claude` was not found at any probed location.
	ClaudePath string
	// Probed lists every path considered, in probe order — always populated, so a miss can be
	// explained, not just reported.
	Probed []string
}

// Result is Remove's outcome — see the Outcome* constants below. Remove never returns a Go error:
// the outcome is a value the pane renders.
type Result struct {
	Outcome string
	// Detail is a bounded, single-line reason on removeFailed — never the token, never a child's
	// stderr verbatim beyond what exec.go's firstLineBounded already truncated it to.
	Detail string
	Probed []string
}

const (
	// OutcomeNotFound: `claude` not found anywhere in the probe order — not a failure state (§7.2):
	// the command is already on screen to copy, and needs no fallback of its own.
	OutcomeNotFound = "notFound"
	// OutcomeRemoved: `claude` found, and the server is no longer registered under that name.
	OutcomeRemoved = "removed"
	// OutcomeRemoveFailed: `claude mcp remove` failed for a reason other than "not registered".
	OutcomeRemoveFailed = "removeFailed"
)

// locateClaude checks PATH first, then every absolute candidate in order, every path considered
// recorded in probed regardless of outcome.
func (i *Installer) locateClaude() (path string, probed []string, found bool) {
	return toolexec.Locate(i.lookPath, i.stat, "claude", toolexec.ClaudeCandidates())
}

// Status is the pane's own pre-click read.
func (i *Installer) Status() Status {
	path, probed, _ := i.locateClaude()
	return Status{ClaudePath: path, Probed: probed}
}

// ShellQuote wraps s in single quotes for embedding as a literal argument inside the
// generated /bin/sh script above (the one place in this package that composes a shell string
// rather than an argv slice, since the script itself IS shell) — escaping any embedded single
// quote the standard POSIX way, as
//
//	'\''
//
// — close the quote, an escaped quote, reopen it.
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// serverJSON is `claude mcp add-json`'s own input shape, restricted to the one field combination
// this package ever sends — Type/URL/HeadersHelper, never a plaintext Headers map (F2's whole
// point).
type serverJSON struct {
	Type          string `json:"type"`
	URL           string `json:"url"`
	HeadersHelper string `json:"headersHelper"`
}

// Command renders a remove-then-add-json pair for a user to run themselves — shown with shell-style quoting for copy-paste rather than passed through a
// shell. No token anywhere in this string (F2): helperPath names a local script, never a secret
// itself, so unlike the old `--header "Authorization: Bearer <token>"` form this is safe to display
// and safe to have landed in a shell history.
//
// F10: headersHelper is shell-quoted — a helperPath containing a space (KIRA_HOME or
// $HOME with one, common on macOS for a custom KIRA_HOME) would otherwise break into two shell
// words once Claude Code later runs the stored headersHelper string through a shell of its own,
// silently sending no Authorization header and failing every call with an unexplained 401.
func Command(name, url, helperPath string) string {
	payload, _ := json.Marshal(serverJSON{Type: "http", URL: url, HeadersHelper: ShellQuote(helperPath)})
	return "claude mcp remove --scope user " + ShellQuote(name) + " 2>/dev/null; claude mcp add-json --scope user " +
		ShellQuote(name) + " " + ShellQuote(string(payload))
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

// isNotRegisteredError reports whether err is `claude mcp remove`'s own "nothing to remove" outcome
// (verified against the installed CLI, 2.1.280: exit 1, stderr `No MCP server named "<name>" in
// user scope`) — the one remove failure Remove treats as success.
func isNotRegisteredError(err error) bool {
	var runErr *toolexec.ExecError
	if !errors.As(err, &runErr) {
		return false
	}
	return strings.Contains(runErr.Stderr, "No MCP server named")
}

// Remove unregisters name from the user scope. A name that is not registered counts as removed.
func (i *Installer) Remove(ctx context.Context, name string) Result {
	claudePath, probed, found := i.locateClaude()
	if !found {
		return Result{Outcome: OutcomeNotFound, Probed: probed}
	}
	spawnCtx, cancel := context.WithTimeout(ctx, spawnTimeout)
	defer cancel()
	if err := i.run(spawnCtx, claudePath, []string{"mcp", "remove", "--scope", "user", name}); err != nil && !isNotRegisteredError(err) {
		return Result{Outcome: OutcomeRemoveFailed, Detail: detailFor(spawnCtx, err), Probed: probed}
	}
	return Result{Outcome: OutcomeRemoved, Probed: probed}
}
