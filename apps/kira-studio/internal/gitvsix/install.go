// Package gitvsix locates the `.vsix` bundled inside a packaged `Kira Studio.app` and installs it
// into VS Code, or reveals it in Finder when `code` isn't available — SPEC §7's `internal/git*`
// convention for a git-chapter domain package (G10 D10). It imports nothing from `internal/bridge`
// (the Wails adapter layer, kept honest by `internal/layering_test.go`) and nothing from
// `internal/gitclient` (it shares that package's *discipline* — argv-only, no shell — not its
// code: a git spawn and a `code` spawn have nothing else in common).
package gitvsix

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// vsixFileName is the fixed name create:app:bundle copies the packaged extension to, and the one
// this package looks for beside the running executable (D8/D11). No version in the name — the
// version lives inside the manifest, where `code` reads it — so this constant is the one place a
// future phase would change to ship more than one side by side.
const vsixFileName = "kira-version.vsix"

// Deps are the four independent seams D13 calls for: locating this binary, finding `code`/`open`,
// checking a candidate exists, and spawning one. Function fields rather than an interface — there
// is no shared behaviour to abstract across four unrelated operations, and a test can inject each
// independently (a fake Run that records argv, a fake LookPath answering from a table, a real
// os.Stat over a t.TempDir()). A zero-value field falls back to the real OS implementation (New).
type Deps struct {
	Executable func() (string, error)
	LookPath   func(string) (string, error)
	Stat       func(string) (os.FileInfo, error)
	Run        func(ctx context.Context, path string, args []string) error
}

// Installer is D10's whole surface, constructed once (main.go) and shared for the app's life —
// it holds no mutable state of its own; every call re-resolves both the `.vsix` and `code` fresh,
// so an install that happens after Status was last read (installing VS Code's own `code` CLI, or
// building a fresh packaged app) is never stale.
type Installer struct {
	executable func() (string, error)
	lookPath   func(string) (string, error)
	stat       func(string) (os.FileInfo, error)
	run        func(ctx context.Context, path string, args []string) error
}

// New constructs an Installer over d, substituting the real OS implementation for any zero-value
// field — the shape every seam-carrying constructor in this codebase uses (gitclient.NewRunner,
// gitaskpass.New).
func New(d Deps) *Installer {
	i := &Installer{executable: d.Executable, lookPath: d.LookPath, stat: d.Stat, run: d.Run}
	if i.executable == nil {
		i.executable = realExecutable
	}
	if i.lookPath == nil {
		i.lookPath = realLookPath
	}
	if i.stat == nil {
		i.stat = realStat
	}
	if i.run == nil {
		i.run = realRun
	}
	return i
}

// Status is D10's advisory read — the pane's own pre-click render, never the authority: Install
// re-resolves everything itself, so a `code` installed (or a `.vsix` rebuilt) after Status was
// last read still works on the next click.
type Status struct {
	// Bundled reports whether a .vsix was found beside the running executable.
	Bundled bool
	// VsixPath is "" unless Bundled.
	VsixPath string
	// CodePath is "" when `code` was not found at any probed location.
	CodePath string
	// Probed lists every path considered for `code`, in probe order — always populated, so a miss
	// can be explained rather than just reported (the same reason gitclient.GitStatus carries one).
	Probed []string
}

// Result is Install's own outcome — see the Outcome* constants below for the five values it can
// hold. Install never returns a Go error (connections.Service.Reveal / apivars.Reveal's
// precedent, already applied to GitClientsService by G1 D19): a pairing/reveal-shaped user action
// is a value the pane renders, not a failure the caller must handle specially.
type Result struct {
	Outcome  string
	VsixPath string
	CodePath string
	Probed   []string
	// Detail is a bounded, single-line reason on installFailed/revealFailed — never a path secret,
	// never a child's stderr verbatim (firstLineBounded already truncated it in exec.go).
	Detail string
}

// The five outcomes D12 defines, exhaustive — Install always returns exactly one.
const (
	// OutcomeInstalled: `code` found, `code --install-extension --force` exited 0.
	OutcomeInstalled = "installed"
	// OutcomeRevealed: `code` not found anywhere in the probe order, `open -R` succeeded.
	OutcomeRevealed = "revealed"
	// OutcomeNotBundled: no .vsix beside the running executable (a dev build with no .vsix copied
	// in, or a corrupted app bundle) — reported honestly, not as a failure.
	OutcomeNotBundled = "notBundled"
	// OutcomeInstallFailed: `code` was found but exited non-zero or could not be spawned. This
	// does NOT fall through to reveal — a `code` that ran and refused is a different problem from
	// a `code` that was never found, and collapsing the two would hide which one actually happened.
	OutcomeInstallFailed = "installFailed"
	// OutcomeRevealFailed: `code` was not found AND `open -R` also failed.
	OutcomeRevealFailed = "revealFailed"
)

// vsixPath resolves D11's single probe: relative to os.Executable(), never an env override
// (verify-packaging.sh's own S8 forbids an env-driven dev branch in main.go, and the same
// instinct applies here — the dev story is `darwin:run`'s own conditional copy, a real bundle,
// not a variable that makes a non-bundle pretend to be one). Resolves correctly inside both
// `Kira Studio.app` and `Kira Studio.dev.app`; resolves to nothing under `wails3 task dev`.
func (i *Installer) vsixPath() (string, bool) {
	exe, err := i.executable()
	if err != nil {
		return "", false
	}
	path := filepath.Join(filepath.Dir(exe), "..", "Resources", vsixFileName)
	info, err := i.stat(path)
	if err != nil || info.IsDir() {
		return "", false
	}
	return path, true
}

// codeCandidates is D12's exact probe order after the PATH step (locateCode below runs LookPath
// first): the well-known absolute paths a Finder-launched app's launchd-inherited PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) never includes (F12) — VS Code's own "Shell Command: Install
// 'code' command in PATH" writes /usr/local/bin/code, Homebrew installs under /opt/homebrew/bin,
// and the two Applications paths reach into the .app bundle's own bin/code directly. Insiders and
// VSCodium are deliberately NOT probed (D12): installing into an editor the user may not run is a
// worse outcome than the reveal fallback, which lets them drag the file onto whichever editor
// they actually use.
func codeCandidates() []string {
	candidates := []string{
		"/usr/local/bin/code",
		"/opt/homebrew/bin/code",
		"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates,
			filepath.Join(home, "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code"))
	}
	return candidates
}

func isExecutable(stat func(string) (os.FileInfo, error), path string) bool {
	info, err := stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// locateCode mirrors gitclient/discovery.go's darwinLocator shape exactly (F12): PATH first, then
// every absolute candidate in order, every path considered recorded in probed regardless of
// outcome — so a miss can be explained (the Connected Editors pane surfaces Probed), not just
// reported.
func (i *Installer) locateCode() (path string, probed []string, found bool) {
	if resolved, err := i.lookPath("code"); err == nil {
		probed = append(probed, resolved)
		return resolved, probed, true
	}
	probed = append(probed, "code (on PATH)")

	for _, candidate := range codeCandidates() {
		probed = append(probed, candidate)
		if isExecutable(i.stat, candidate) {
			return candidate, probed, true
		}
	}
	return "", probed, false
}

// locateOpen is NOT part of Probed (D12) — `open` is macOS's own, always-present reveal tool, not
// a user-installed editor whose absence is itself diagnostic information.
func (i *Installer) locateOpen() string {
	if resolved, err := i.lookPath("open"); err == nil {
		return resolved
	}
	return "/usr/bin/open"
}

// detailFor turns a failed spawn into Result.Detail: a timeout is reported as such regardless of
// what the child itself returned (WaitDelay/ctx racing is not interesting to a user), a *RunError
// carries its own bounded exit/stderr summary, and anything else (the binary could not be
// spawned at all) is the plain error text.
func detailFor(ctx context.Context, err error) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timed out"
	}
	var runErr *RunError
	if errors.As(err, &runErr) {
		return runErr.Error()
	}
	return err.Error()
}

// Status is D14's advisory read for the Connected Editors pane's pre-click render.
func (i *Installer) Status() Status {
	vsixPath, bundled := i.vsixPath()
	codePath, probed, _ := i.locateCode()
	st := Status{Bundled: bundled, Probed: probed, CodePath: codePath}
	if bundled {
		st.VsixPath = vsixPath
	}
	return st
}

// Install is D12 end to end. It re-resolves the .vsix and `code` fresh (never trusts a prior
// Status) and never returns a Go error — every outcome is a named Result value.
func (i *Installer) Install(ctx context.Context) Result {
	vsixPath, bundled := i.vsixPath()
	if !bundled {
		return Result{Outcome: OutcomeNotBundled}
	}

	codePath, probed, found := i.locateCode()
	if found {
		spawnCtx, cancel := context.WithTimeout(ctx, spawnTimeout)
		defer cancel()
		err := i.run(spawnCtx, codePath, []string{"--install-extension", vsixPath, "--force"})
		if err == nil {
			return Result{Outcome: OutcomeInstalled, VsixPath: vsixPath, CodePath: codePath, Probed: probed}
		}
		// D12: installFailed never falls through to reveal — a `code` that ran and refused is a
		// different problem from a `code` that was never found.
		return Result{
			Outcome: OutcomeInstallFailed, VsixPath: vsixPath, CodePath: codePath, Probed: probed,
			Detail: detailFor(spawnCtx, err),
		}
	}

	openPath := i.locateOpen()
	spawnCtx, cancel := context.WithTimeout(ctx, spawnTimeout)
	defer cancel()
	err := i.run(spawnCtx, openPath, []string{"-R", vsixPath})
	if err == nil {
		return Result{Outcome: OutcomeRevealed, VsixPath: vsixPath, Probed: probed}
	}
	return Result{Outcome: OutcomeRevealFailed, VsixPath: vsixPath, Probed: probed, Detail: detailFor(spawnCtx, err)}
}
