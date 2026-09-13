package startupfail

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

// Deps are the seams a Reporter needs, Deps-shaped exactly like internal/gitvsix's own (D8):
// zero-value fields fall back to the real OS (NewReporter, below), and a fake Run is what lets a
// Linux test assert "the correct argv was built and the correct body was passed" with no macOS
// present and no real subprocess spawned.
type Deps struct {
	LookPath func(string) (string, error)
	Stat     func(string) (os.FileInfo, error)
	Run      func(ctx context.Context, path string, args []string, stdin []byte) (stdout string, err error)
	// Getenv is read for exactly one key, KIRA_NO_STARTUP_ALERT (D9) — never in main.go (F13).
	Getenv func(string) string
	Stderr io.Writer
	// Log is the seam over slog.Error(...) (D2) — a fake in report_test.go can capture it without
	// depending on log/slog's own global state.
	Log func(msg string, args ...any)
	Now func() time.Time
}

// Reporter is D8's whole surface: constructed once over real Deps for the package-level
// Fatal/Report/ReportPlatform functions below, and constructed fresh per test with fakes.
type Reporter struct {
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
	run      func(ctx context.Context, path string, args []string, stdin []byte) (string, error)
	getenv   func(string) string
	stderr   io.Writer
	log      func(msg string, args ...any)
	now      func() time.Time

	// alertOnce guards D7's "at most one alert is ever shown per process" — logging and the
	// stderr write always happen on every call; only the actual osascript spawn is gated. Scoped
	// to the Reporter (not a package-level var) so independent Reporters in tests never share
	// state with each other or with the package-level defaultReporter.
	alertOnce sync.Once
}

// NewReporter constructs a Reporter over d, substituting the real OS implementation for any
// zero-value field — the same shape every seam-carrying constructor in this codebase uses
// (gitvsix.New, gitclient.NewRunner).
func NewReporter(d Deps) *Reporter {
	r := &Reporter{
		lookPath: d.LookPath, stat: d.Stat, run: d.Run, getenv: d.Getenv,
		stderr: d.Stderr, log: d.Log, now: d.Now,
	}
	if r.lookPath == nil {
		r.lookPath = realLookPath
	}
	if r.stat == nil {
		r.stat = realStat
	}
	if r.run == nil {
		r.run = realRun
	}
	if r.getenv == nil {
		r.getenv = realGetenv
	}
	if r.stderr == nil {
		r.stderr = os.Stderr
	}
	if r.log == nil {
		r.log = func(msg string, args ...any) { slog.Error(msg, args...) }
	}
	if r.now == nil {
		r.now = time.Now
	}
	return r
}

// Report is D2's ordering, unconditionally, every time: (1) log via slog — degrading correctly to
// the standard library's own stderr handler when logging.Init hasn't run yet (F2), and to the
// file it installed when it has, with no branch either way; (2) write the full rendered text to
// stderr — what a developer running `wails3 task dev`, and any future CI harness, actually reads,
// and the whole output on a platform where the alert cannot be shown at all; (3) attempt the
// alert. Order matters: log first, so a crash or hang inside the presenter can never lose the
// diagnosis.
func (r *Reporter) Report(step Step, err error) {
	msg := Classify(step, err)

	r.log(msg.Headline, "scope", "startup", "step", string(step), "err", err)

	title, body := RenderAlert(msg)
	fmt.Fprintf(r.stderr, "[%s] kira-studio-shell: %s: %s\n\n%s\n\n",
		r.now().UTC().Format(time.RFC3339), step, title, body)

	r.present(msg, err)
}

// present is step (3): the KIRA_NO_STARTUP_ALERT escape hatch (D9) gates it entirely — logging and
// the stderr write above have already happened regardless — and alertOnce (D7) bounds it to at
// most one spawn per Reporter.
func (r *Reporter) present(msg Message, err error) {
	if envDisablesAlert(r.getenv("KIRA_NO_STARTUP_ALERT")) {
		return
	}
	r.alertOnce.Do(func() {
		r.showAlert(msg, err)
	})
}

// envDisablesAlert implements D9 exactly: "" / "0" / "false" leave the alert enabled; anything
// else disables it.
func envDisablesAlert(v string) bool {
	switch v {
	case "", "0", "false":
		return false
	default:
		return true
	}
}

// locateBinary implements D3's "Locating the binary": LookPath first, then Stat on the fixed
// fallback path used only when LookPath fails to resolve it. Neither succeeding means "unavailable"
// — the caller's job, not this function's, to treat that as a silent no-op rather than an error.
func (r *Reporter) locateBinary(name, fallback string) (string, bool) {
	if p, err := r.lookPath(name); err == nil && p != "" {
		return p, true
	}
	if _, err := r.stat(fallback); err == nil {
		return fallback, true
	}
	return "", false
}

// showAlert spawns osascript (D3), bounded by alertTimeout (D8), and — if and only if its stdout
// trims to exactly "Copy Details" — follows up with copyDetails (D10). Every other outcome
// (osascript missing, a non-zero exit, a spawn failure, "OK" pressed, empty stdout) is treated as
// "dismissed": return, with no error and no panic. D2's stderr write has already happened by the
// time this runs, so an unshowable alert is never the whole story.
func (r *Reporter) showAlert(msg Message, err error) {
	path, ok := r.locateBinary("osascript", osascriptFallbackPath)
	if !ok {
		return
	}
	title, body := RenderAlert(msg)
	ctx, cancel := context.WithTimeout(context.Background(), alertTimeout)
	defer cancel()
	stdout, runErr := r.run(ctx, path, alertArgv(title, body), nil)
	if runErr != nil {
		return
	}
	if strings.TrimSpace(stdout) != buttonCopyDetails {
		return
	}
	r.copyDetails(msg, err)
}

// copyDetails is D10's second spawn: /usr/bin/pbcopy, argv-only, the same bounded discipline,
// fed the full uncapped clipboard payload (RenderClipboard) on stdin. Its own failure (pbcopy
// missing, a non-zero exit) is likewise a silent no-op — the process is already on its way out.
func (r *Reporter) copyDetails(msg Message, err error) {
	path, ok := r.locateBinary("pbcopy", pbcopyFallbackPath)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), alertTimeout)
	defer cancel()
	payload := RenderClipboard(msg, err)
	_, _ = r.run(ctx, path, nil, []byte(payload))
}

// defaultReporter is what the package-level Fatal/Report/ReportPlatform functions below use — the
// real OS, exactly once per process, constructed at package init with an empty Deps{} (every
// field falls back per NewReporter).
var defaultReporter = NewReporter(Deps{})

// Fatal is D6's whole boot-failure posture: Report, then exit 1 — the same exit code every
// log.Fatalf call site it replaces already produced, preserved exactly.
func Fatal(step Step, err error) {
	defaultReporter.Report(step, err)
	os.Exit(1)
}

// Report logs, writes to stderr, and attempts the alert, without exiting — used by main.go's own
// ErrorHandler wiring (via ReportPlatform below) where Wails' own os.Exit(1) follows immediately
// afterward (D7): this function must never call os.Exit itself.
func Report(step Step, err error) {
	defaultReporter.Report(step, err)
}

// ReportPlatform is StepPlatform's own entry point (D7) — the one seam main.go's
// application.Options.ErrorHandler calls into, after doing its own *application.FatalError type
// assertion (the only place in this package's contract that acknowledges pkg/application exists,
// and it does so from the caller's side: this package imports nothing from pkg/application, per
// internal/shell/app.go's documented rule that only main.go and internal/shell may).
func ReportPlatform(err error) {
	defaultReporter.Report(StepPlatform, err)
}
