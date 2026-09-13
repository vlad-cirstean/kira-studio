package ghclient

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Locator resolves a candidate `gh` binary path, without running it — D3's own narrowed probe
// order (PATH -> /opt/homebrew/bin/gh -> /usr/local/bin/gh, no CLT-shim gate, no configured-path
// step at all).
type Locator interface {
	// Locate returns the first usable candidate, and the full list of paths considered (in probe
	// order) either way.
	Locate() (path string, probed []string, found bool)
}

func isExecutable(stat func(string) (os.FileInfo, error), path string) bool {
	info, err := stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

type platformLocator struct {
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
}

// NewPlatformLocator returns D3's own probe order: PATH, then /opt/homebrew/bin/gh, then
// /usr/local/bin/gh — unlike gitclient's own NewPlatformLocator, this is not gated on
// runtime.GOOS == "darwin": `gh` has no macOS-only distribution story the way this app's
// git-discovery chapter does, and the two extra absolute-path candidates are simply skipped (via
// isExecutable's own os.Stat miss) on a platform where they do not exist.
func NewPlatformLocator() Locator {
	return &platformLocator{lookPath: exec.LookPath, stat: os.Stat}
}

func (l *platformLocator) Locate() (string, []string, bool) {
	var probed []string

	if resolved, err := l.lookPath("gh"); err == nil {
		probed = append(probed, resolved)
		return resolved, probed, true
	}
	probed = append(probed, "gh (on PATH)")

	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		candidate := filepath.Join(dir, "gh")
		probed = append(probed, candidate)
		if isExecutable(l.stat, candidate) {
			return candidate, probed, true
		}
	}

	return "", probed, false
}

// Clock is the time seam Discovery's own TTL cache reads through — a plain interface (not
// gitclient.Clock, to keep this package's own dependency surface at stdlib-only) so a test can fake
// it exactly as gitclient/discovery_test.go's own fakeClock does.
type Clock interface {
	Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// NewRealClock returns the real, time.Now()-backed Clock.
func NewRealClock() Clock { return realClock{} }

// okTTL/notOKTTL are D3's own asymmetric cache window, keyed per host: five minutes when the last
// probe of that host came back "ok" (a healthy `gh` rarely needs re-checking), thirty seconds when
// it did not (an unauthenticated or rate-limited state is exactly the kind of thing a user might
// fix — `gh auth login` in another terminal — and expects this app to notice soon, not five minutes
// later).
const (
	okTTL    = 5 * time.Minute
	notOKTTL = 30 * time.Second
)

type cacheEntry struct {
	status   Status
	cachedAt time.Time
}

// Discovery is D3 end to end: Locate a candidate, run --version then `gh auth status --hostname
// <host>` on it, and classify the result into Status — cached per host with D3's own asymmetric
// TTL via Clock, so a fake clock can prove both directions with no real sleep.
type Discovery struct {
	locator Locator
	runner  Runner
	clock   Clock

	mu    sync.Mutex
	cache map[string]cacheEntry
}

// NewDiscovery constructs a Discovery over the given Locator/Runner/Clock.
func NewDiscovery(locator Locator, runner Runner, clock Clock) *Discovery {
	return &Discovery{locator: locator, runner: runner, clock: clock, cache: make(map[string]cacheEntry)}
}

// Status resolves and classifies gh's own auth state for host, reusing a cached result within
// D3's own asymmetric TTL.
func (d *Discovery) Status(ctx context.Context, host string) Status {
	d.mu.Lock()
	if entry, ok := d.cache[host]; ok {
		ttl := notOKTTL
		if entry.status.OK() {
			ttl = okTTL
		}
		if d.clock.Now().Sub(entry.cachedAt) < ttl {
			cached := entry.status
			d.mu.Unlock()
			return cached
		}
	}
	d.mu.Unlock()

	status := d.probe(ctx, host)

	// G31 round-2 architecture/security review, finding #5 (mirror of gitclient's own discovery.go
	// finding #1, apps/kira-studio/internal/gitclient/discovery.go): a caller-cancelled ctx killed
	// probe's own spawn mid-flight, which used to be indistinguishable from "gh is genuinely
	// unavailable/unauthenticated" and got cached under notOKTTL — poisoning every OTHER caller's
	// Status(host) for up to 30s over an event that says nothing about gh at all. Skip the cache
	// write when the CALLER's own ctx (not either sub-probe's own versionProbeTimeout/
	// authProbeTimeout, which are real "gh took too long" signals worth caching) was cancelled out
	// from under this probe.
	if errors.Is(ctx.Err(), context.Canceled) {
		return status
	}

	d.mu.Lock()
	d.cache[host] = cacheEntry{status: status, cachedAt: d.clock.Now()}
	d.mu.Unlock()
	return status
}

// Hosts returns every host this Discovery has ever probed — D15's own "is this a GitHub
// repository" test consults this alongside a literal "github.com" check, so a GHES host that has
// ever answered "ok" here is recognised on every later call too.
func (d *Discovery) Hosts(_ context.Context) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	hosts := make([]string, 0, len(d.cache))
	for h, entry := range d.cache {
		if entry.status.OK() {
			hosts = append(hosts, h)
		}
	}
	return hosts
}

// probe is D3's own three-step order: Locate() -> `gh --version` -> `gh auth status --hostname
// <host>` -> classify. No CLT-shim gate (there is none for gh) and no version floor (every call
// this package makes has been stable since gh 1.0).
func (d *Discovery) probe(ctx context.Context, host string) Status {
	path, probed, found := d.locator.Locate()
	if !found {
		return Status{
			Kind: KindNotFound, Host: host, Probed: probed,
			Reason: "GitHub CLI is unavailable — install `gh` to see pull request status",
		}
	}

	versionCtx, cancel := context.WithTimeout(ctx, versionProbeTimeout)
	res, err := d.runner.Run(versionCtx, path, Spec{Args: []string{"--version"}, Timeout: versionProbeTimeout})
	cancel()
	if errors.Is(err, context.DeadlineExceeded) {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh --version did not respond within 5s"}
	}
	// The caller's own ctx (not versionCtx's own sub-timeout above) was cancelled mid-probe — the
	// killed process's own error below says nothing about whether gh works, so don't report it as
	// though it did (Status's own caller-cancelled check is what keeps this out of the cache; this
	// just keeps the immediate Reason honest for anyone who logs it).
	if errors.Is(ctx.Err(), context.Canceled) {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "the request was cancelled"}
	}
	if err != nil {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh could not be started: " + err.Error()}
	}
	if res.ExitCode != 0 {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh could not be started"}
	}
	version, ok := parseGhVersion(string(res.Stdout))
	if !ok {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh did not report a version"}
	}

	authCtx, cancel := context.WithTimeout(ctx, authProbeTimeout)
	authRes, err := d.runner.Run(authCtx, path, Spec{Args: []string{"auth", "status", "--hostname", host}, Timeout: authProbeTimeout})
	cancel()
	if errors.Is(err, context.DeadlineExceeded) {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh auth status did not respond within 10s"}
	}
	// Mirrors the version sub-probe's own check above: the caller's ctx (not authCtx's own
	// sub-timeout) was cancelled mid-probe, so the killed process's error says nothing about
	// whether gh/auth actually work.
	if errors.Is(ctx.Err(), context.Canceled) {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "the request was cancelled"}
	}
	if err != nil {
		return Status{Kind: KindNotFound, Host: host, Path: path, Reason: "gh could not be started: " + err.Error()}
	}
	if authRes.ExitCode != 0 {
		return Status{
			Kind: KindUnauthenticated, Host: host, Path: path, Version: version,
			Reason: "not logged in to " + host + " — run `gh auth login`",
		}
	}

	account := parseGhAuthAccount(string(authRes.Stdout) + string(authRes.Stderr))
	return Status{Kind: KindOK, Host: host, Path: path, Version: version, Account: account}
}

// parseGhVersion extracts the dotted version token from `gh --version`'s own first line: "gh
// version 2.42.0 (2024-01-08)".
func parseGhVersion(output string) (string, bool) {
	fields := strings.Fields(output)
	if len(fields) < 3 || fields[0] != "gh" || fields[1] != "version" {
		return "", false
	}
	return fields[2], true
}

// parseGhAuthAccount extracts the account name from `gh auth status`'s own "Logged in to
// github.com account octocat (keyring)" line — best-effort, informational only (Status.Account is
// never used to gate anything); an unrecognised format simply leaves it empty.
func parseGhAuthAccount(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		idx := strings.Index(line, "account ")
		if idx < 0 {
			continue
		}
		rest := strings.TrimSpace(line[idx+len("account "):])
		fields := strings.Fields(rest)
		if len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}
