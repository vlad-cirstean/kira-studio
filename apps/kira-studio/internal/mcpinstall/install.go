// Package mcpinstall registers the DB MCP server's embedded instance with Claude Code's own CLI
// (docs/v1.7/plans/M1-db-mcp-server-core.md) — the one client this app installs for. Every real
// spawn Install makes is argv-only, never a shell, never writes another program's config file
// directly — the same discipline internal/gitvsix already applies to its own `code` spawn, though
// the two packages share no code (unrelated problems, no probe order worth factoring out). Command
// is the one exception: it renders shell syntax (`;`, redirection) purely as copy-paste TEXT for
// the pane's fallback UI, never executed by this package itself.
package mcpinstall

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// headerHelperScriptName is the fixed script name every DB MCP registration's own headersHelper
// points at (P108 Part 7 F2). Its content is a fixed template with no secret embedded — only the
// helper token file's own path, which is not itself sensitive — so it is written once and then
// left alone; EnsureHeaderHelperScript rewrites it unconditionally anyway (idempotent, cheap) so it
// self-heals if it is ever missing or a future version changes the template.
const headerHelperScriptName = "mcp-header-helper.sh"

// HeaderHelperScriptPath is EnsureHeaderHelperScript's own path, computed with no file I/O — a
// caller that already knows the script exists (statusFn's own repeated reads, once startFn has
// ensured it) can build the same path this way rather than re-writing the file on every read.
func HeaderHelperScriptPath(home string) string {
	return filepath.Join(home, headerHelperScriptName)
}

// EnsureHeaderHelperScript writes (or rewrites) the headersHelper script every DB MCP registration
// names — a plain shell script that reads tokenPath's own live plaintext at connection time and
// emits it as the `{"Authorization": "Bearer ..."}` JSON object Claude Code's headersHelper
// mechanism expects on stdout (verified against the installed CLI, 2.1.280: it runs the named
// command and parses its stdout as a JSON object of header name to string value — undocumented in
// `--help`, but real, and it re-runs the command on every connection attempt, so a token rotation
// that only rewrites tokenPath's own content needs no re-registration at all). 0700 (owner rwx
// only): this script's own path is what an add-json call names, never a secret itself, but only
// this file's owner should be able to run or read it. Called once per embedded server start
// (bridge/dbmcp.go's own startFn) — idempotent and cheap, so a repeat call (a second enable within
// the same app run) just rewrites the identical content.
func EnsureHeaderHelperScript(home, tokenPath string) (string, error) {
	if err := os.MkdirAll(home, 0o700); err != nil {
		return "", fmt.Errorf("mcpinstall: mkdir %s: %w", home, err)
	}
	scriptPath := HeaderHelperScriptPath(home)
	content := "#!/bin/sh\n" +
		"# Kira Studio DB MCP headersHelper — regenerated by the app on every start; do not edit.\n" +
		"tok=$(cat " + shellSingleQuote(tokenPath) + ") || exit 1\n" +
		"printf '{\"Authorization\":\"Bearer %s\"}' \"$tok\"\n"
	if err := os.WriteFile(scriptPath, []byte(content), 0o700); err != nil {
		return "", fmt.Errorf("mcpinstall: write header helper script: %w", err)
	}
	return scriptPath, nil
}

// shellSingleQuote wraps s in single quotes for embedding as a literal argument inside the
// generated /bin/sh script above (the one place in this package that composes a shell string
// rather than an argv slice, since the script itself IS shell) — escaping any embedded single
// quote the standard POSIX way ('\” — close the quote, an escaped quote, reopen it).
func shellSingleQuote(s string) string {
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

// Command renders the exact two-step argv Install spawns (F3: remove, ignoring "not registered",
// then add-json) — shown with shell-style quoting for copy-paste rather than passed through a
// shell. No token anywhere in this string (F2): helperPath names a local script, never a secret
// itself, so unlike the old `--header "Authorization: Bearer <token>"` form this is safe to display
// and safe to have landed in a shell history.
func Command(name, url, helperPath string) string {
	payload, _ := json.Marshal(serverJSON{Type: "http", URL: url, HeadersHelper: helperPath})
	return "claude mcp remove --scope user " + name + " 2>/dev/null; claude mcp add-json --scope user " +
		name + " '" + string(payload) + "'"
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
// user scope`) — the one remove failure Install must treat as success rather than propagate (F3).
func isNotRegisteredError(err error) bool {
	var runErr *toolexec.ExecError
	if !errors.As(err, &runErr) {
		return false
	}
	return strings.Contains(runErr.Stderr, "No MCP server named")
}

// Install re-resolves `claude` fresh and never returns a Go error — every outcome is a named
// Result value (§7.2's own "Install button" spec). helperPath is EnsureHeaderHelperScript's own
// return value — the local script's path, never a token.
//
// Removes any existing registration under name first (F3): add-json fails outright on a name
// collision, and F2's headersHelper design means a token rotation never needs re-registration at
// all — but the Install button itself can still be clicked again (a stale registration from an
// older app version's `--header` form, or simply re-running it), so this stays idempotent
// regardless. A "nothing to remove" outcome is not a failure and is never surfaced as one.
func (i *Installer) Install(ctx context.Context, name, url, helperPath string) Result {
	claudePath, probed, found := i.locateClaude()
	if !found {
		return Result{Outcome: OutcomeNotFound, Probed: probed}
	}

	spawnCtx, cancel := context.WithTimeout(ctx, spawnTimeout)
	defer cancel()

	removeArgs := []string{"mcp", "remove", "--scope", "user", name}
	if err := i.run(spawnCtx, claudePath, removeArgs); err != nil && !isNotRegisteredError(err) {
		return Result{Outcome: OutcomeInstallFailed, Detail: detailFor(spawnCtx, err), Probed: probed}
	}

	payload, err := json.Marshal(serverJSON{Type: "http", URL: url, HeadersHelper: helperPath})
	if err != nil {
		return Result{Outcome: OutcomeInstallFailed, Detail: err.Error(), Probed: probed}
	}
	addArgs := []string{"mcp", "add-json", "--scope", "user", name, string(payload)}
	if err := i.run(spawnCtx, claudePath, addArgs); err != nil {
		return Result{Outcome: OutcomeInstallFailed, Detail: detailFor(spawnCtx, err), Probed: probed}
	}
	return Result{Outcome: OutcomeInstalled, Probed: probed}
}
