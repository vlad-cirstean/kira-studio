package gitclient

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RequiredVersion is the hard floor (docs/v1.3/SPEC.md, "The user's own Git, at 2.38 or newer") —
// `git merge-tree --write-tree` (2.38) is what a later phase's conflict prediction needs to be
// exact rather than heuristic.
const RequiredVersion = "2.38.0"

// GitPathSettingID is the settings key GitStatus.SettingID names — `git-core`'s SETTINGS schema
// key verbatim (packages/git-core/src/settings/schema.ts), kept here as a literal rather than
// imported (Go cannot import TypeScript; OQ-2 defers real settings-surface integration).
const GitPathSettingID = "git.path"

// GitStatus is D4's blocking-state discriminant — the wire shape crossing as 'app.init's `git`
// field, structurally matching @kira/git-ipc's own GitStatus union (contract.ts) field-for-field;
// git-ui's GitBlockedPanel.vue/gitBlockedCopy.ts already render every non-"ok" Kind unchanged.
// Every field below is used by exactly one Kind — see gitBlockedCopy.ts's own switch for which.
type GitStatus struct {
	Kind      string   `json:"kind"` // "ok" | "notFound" | "tooOld" | "unusable"
	Path      string   `json:"path,omitempty"`
	Version   string   `json:"version,omitempty"`
	Probed    []string `json:"probed,omitempty"`
	Detected  string   `json:"detected,omitempty"`
	Required  string   `json:"required,omitempty"`
	SettingID string   `json:"settingId,omitempty"`
	Reason    string   `json:"reason,omitempty"`
}

// Locator resolves a candidate git binary path via one platform's own probe order, without
// running or validating it — Discovery.Status (below) is what runs --version and enforces
// RequiredVersion. Kept separate from Discovery so D3's per-platform strategy is a small,
// independently fakeable seam (darwinLocator's own test never has to run a real --version).
type Locator interface {
	// Locate returns the first usable candidate, and the full list of paths considered (in probe
	// order) either way — notFound's own Probed field is exactly this list on a miss.
	Locate(configuredPath string) (path string, probed []string, found bool)
}

// isExecutable reports whether path exists, is a regular file (or a symlink to one), and has at
// least one executable bit set — the same check exec.LookPath makes internally, exposed here so
// the homebrew/usr-local/usr-bin steps below (none of which go through LookPath, since they are
// absolute-path checks, not a PATH search) can make it too.
func isExecutable(stat func(string) (os.FileInfo, error), path string) bool {
	info, err := stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// clToolsShim is the Xcode Command Line Tools' own git shim — the one path D3's own trap is
// about. It is filepath.Clean'd on both sides of every comparison below so a caller-supplied
// git.path of "/usr/bin/git/" or similar still matches.
const clToolsShim = "/usr/bin/git"

// darwinLocator implements D3's exact probe order: git.path setting -> PATH ->
// /opt/homebrew/bin -> /usr/local/bin -> /usr/bin/git. A PATH resolution that lands on the CL
// Tools shim is deliberately NOT accepted at the PATH step (unlike every other step, which
// accepts its candidate immediately) — it falls through to the final, xcode-select-gated step
// instead, so the shim is never treated as "found via PATH" without that gate having run. This is
// what keeps the probe order itself the single place that decides whether the shim gets spawned
// at all, rather than an incidental PATH hit bypassing the gate.
type darwinLocator struct {
	lookPath      func(string) (string, error)
	stat          func(string) (os.FileInfo, error)
	cltsInstalled func() bool
}

// NewDarwinLocator returns the real macOS Locator: exec.LookPath, os.Stat, and a real
// `xcode-select -p` probe for the Command Line Tools gate.
func NewDarwinLocator() Locator {
	return &darwinLocator{lookPath: exec.LookPath, stat: os.Stat, cltsInstalled: commandLineToolsInstalled}
}

// commandLineToolsInstalled runs `xcode-select -p` — not a git command, so this carries none of
// clToolsShim's own risk. Exit 0 means CL Tools (or a full Xcode install) is present; exit 2 means
// it is not. Any other failure (xcode-select itself missing, which would be unusual) is treated
// as "not installed" — the safe direction, since the alternative is spawning the shim blind.
func commandLineToolsInstalled() bool {
	return exec.Command("xcode-select", "-p").Run() == nil
}

func (l *darwinLocator) Locate(configuredPath string) (string, []string, bool) {
	var probed []string

	if configuredPath != "" {
		probed = append(probed, configuredPath)
		if isExecutable(l.stat, configuredPath) {
			return configuredPath, probed, true
		}
	}

	if resolved, err := l.lookPath("git"); err == nil && filepath.Clean(resolved) != clToolsShim {
		probed = append(probed, resolved)
		return resolved, probed, true
	}
	probed = append(probed, "git (on PATH)")

	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		candidate := filepath.Join(dir, "git")
		probed = append(probed, candidate)
		if isExecutable(l.stat, candidate) {
			return candidate, probed, true
		}
	}

	if l.cltsInstalled() {
		probed = append(probed, clToolsShim)
		if isExecutable(l.stat, clToolsShim) {
			return clToolsShim, probed, true
		}
	} else {
		probed = append(probed, clToolsShim+" (skipped: Xcode Command Line Tools not installed)")
	}

	return "", probed, false
}

// unsupportedLocator is D3's explicit non-macOS case: "Windows/Linux ... returning a 'platform
// not supported yet' error" rather than attempting (and silently misbehaving on) a probe order
// designed around macOS's own filesystem layout.
type unsupportedLocator struct{ platform string }

func (u unsupportedLocator) Locate(string) (string, []string, bool) {
	return "", []string{"git discovery is not implemented on " + u.platform + " yet"}, false
}

// NewPlatformLocator selects D3's named per-platform strategy on runtime.GOOS — only darwin is
// implemented (docs/v1.3/SPEC.md, "macOS only").
func NewPlatformLocator() Locator {
	if runtime.GOOS == "darwin" {
		return NewDarwinLocator()
	}
	return unsupportedLocator{platform: runtime.GOOS}
}

// parseGitVersion extracts the dotted version token from `git --version`'s stdout — "git version
// 2.42.0" or "git version 2.42.0 (Apple Git-135)" on macOS. strings.Fields is the whole parser
// (§0.2: anything more than this is P2's porcelain-parsing territory, not P1's).
func parseGitVersion(output string) (string, bool) {
	fields := strings.Fields(output)
	if len(fields) < 3 || fields[0] != "git" || fields[1] != "version" {
		return "", false
	}
	return fields[2], true
}

// versionTriple parses the leading digits of up to the first three dot-separated segments,
// tolerating a trailing non-numeric suffix a real build sometimes carries (e.g. "2.38.0.windows.1"
// truncates cleanly at the third segment; "2.38.0-rc1"'s third segment reads its leading "0").
func versionTriple(v string) [3]int {
	var out [3]int
	segments := strings.SplitN(v, ".", 4)
	for i := 0; i < 3 && i < len(segments); i++ {
		digits := segments[i]
		for j, r := range digits {
			if r < '0' || r > '9' {
				digits = digits[:j]
				break
			}
		}
		if n, err := strconv.Atoi(digits); err == nil {
			out[i] = n
		}
	}
	return out
}

// versionLess reports whether a < b as dotted-numeric versions.
func versionLess(a, b string) bool {
	ta, tb := versionTriple(a), versionTriple(b)
	for i := 0; i < 3; i++ {
		if ta[i] != tb[i] {
			return ta[i] < tb[i]
		}
	}
	return false
}

// discoveryTTL bounds how long a resolved GitStatus is trusted before Status re-probes — long
// enough that app.init and a repo.open moments later share one probe (D3's version check is a
// real spawn), short enough that installing/upgrading git and switching back to this app picks it
// up within a session without a restart.
const discoveryTTL = 30 * time.Second

// Discovery is D3 end to end: Locate a candidate, run --version on it, and classify the result
// into GitStatus — cached per configuredPath for discoveryTTL via Clock (D2), so a fake clock can
// prove both "cached within the window" and "re-probed after it" without a real sleep.
type Discovery struct {
	locator Locator
	runner  Runner
	clock   Clock

	mu               sync.Mutex
	cachedAt         time.Time
	cachedConfigured string
	cachedHasValue   bool
	cached           GitStatus
}

// NewDiscovery constructs a Discovery over the given Locator/Runner/Clock — all three D2 seams,
// so a test can fake any combination independently.
func NewDiscovery(locator Locator, runner Runner, clock Clock) *Discovery {
	return &Discovery{locator: locator, runner: runner, clock: clock}
}

// Status resolves and classifies git for configuredPath (the git.path setting's current value,
// "" meaning "use discovery" — OQ-2), reusing a cached result within discoveryTTL.
func (d *Discovery) Status(ctx context.Context, configuredPath string) GitStatus {
	d.mu.Lock()
	if d.cachedHasValue && d.cachedConfigured == configuredPath &&
		d.clock.Now().Sub(d.cachedAt) < discoveryTTL {
		cached := d.cached
		d.mu.Unlock()
		return cached
	}
	d.mu.Unlock()

	status := d.probe(ctx, configuredPath)

	d.mu.Lock()
	d.cached = status
	d.cachedAt = d.clock.Now()
	d.cachedConfigured = configuredPath
	d.cachedHasValue = true
	d.mu.Unlock()
	return status
}

func (d *Discovery) probe(ctx context.Context, configuredPath string) GitStatus {
	path, probed, found := d.locator.Locate(configuredPath)
	if !found {
		return GitStatus{Kind: "notFound", Probed: probed}
	}

	res, err := d.runner.Run(ctx, path, Spec{Args: []string{"--version"}, ReadOnly: true})
	if err != nil {
		return GitStatus{Kind: "unusable", Path: path, Reason: err.Error()}
	}
	if res.ExitCode != 0 {
		return GitStatus{Kind: "unusable", Path: path, Reason: strings.TrimSpace(string(res.Stderr))}
	}
	version, ok := parseGitVersion(string(res.Stdout))
	if !ok {
		return GitStatus{
			Kind: "unusable", Path: path,
			Reason: "could not parse `git --version` output: " + strings.TrimSpace(string(res.Stdout)),
		}
	}
	if versionLess(version, RequiredVersion) {
		return GitStatus{
			Kind: "tooOld", Path: path, Detected: version, Required: RequiredVersion,
			SettingID: GitPathSettingID,
		}
	}
	return GitStatus{Kind: "ok", Path: path, Version: version}
}
