package ghclient

import (
	"context"
	"os"
	"testing"
	"time"
)

type fakeLocator struct {
	path   string
	probed []string
	found  bool
}

func (f fakeLocator) Locate() (string, []string, bool) { return f.path, f.probed, f.found }

// fakeRunner is keyed by the first arg (--version / auth) so a test can script each step's output
// independently — never a real `gh` (F13).
type fakeRunner struct {
	byFirstArg map[string]Result
	errByArg   map[string]error
	calls      int
}

func (f *fakeRunner) Run(_ context.Context, _ string, spec Spec) (Result, error) {
	f.calls++
	key := ""
	if len(spec.Args) > 0 {
		key = spec.Args[0]
	}
	if err, ok := f.errByArg[key]; ok {
		return Result{}, err
	}
	return f.byFirstArg[key], nil
}

type fakeClock struct{ now time.Time }

func (f *fakeClock) Now() time.Time          { return f.now }
func (f *fakeClock) advance(d time.Duration) { f.now = f.now.Add(d) }

func okRunner() *fakeRunner {
	return &fakeRunner{byFirstArg: map[string]Result{
		"--version": {ExitCode: 0, Stdout: []byte("gh version 2.42.0 (2024-01-08)\n")},
		"auth":      {ExitCode: 0, Stdout: []byte("Logged in to github.com account octocat (keyring)\n")},
	}}
}

func TestDiscovery_NotFound(t *testing.T) {
	d := NewDiscovery(fakeLocator{found: false, probed: []string{"a", "b"}}, &fakeRunner{}, &fakeClock{})
	status := d.Status(context.Background(), "github.com")
	if status.Kind != KindNotFound {
		t.Fatalf("Kind = %q, want notFound", status.Kind)
	}
	if len(status.Probed) != 2 {
		t.Fatalf("Probed = %v, want the locator's own list", status.Probed)
	}
}

func TestDiscovery_OK(t *testing.T) {
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{})
	status := d.Status(context.Background(), "github.com")
	if status.Kind != KindOK || status.Version != "2.42.0" || status.Account != "octocat" {
		t.Fatalf("status = %+v, want ok/2.42.0/octocat", status)
	}
}

func TestDiscovery_Unauthenticated(t *testing.T) {
	runner := &fakeRunner{byFirstArg: map[string]Result{
		"--version": {ExitCode: 0, Stdout: []byte("gh version 2.42.0 (2024-01-08)\n")},
		"auth":      {ExitCode: 1, Stderr: []byte("You are not logged into any GitHub hosts.\n")},
	}}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "github.com")
	if status.Kind != KindUnauthenticated || status.Reason == "" {
		t.Fatalf("status = %+v, want unauthenticated with a reason", status)
	}
}

func TestDiscovery_UnparseableVersionIsNotFound(t *testing.T) {
	runner := &fakeRunner{byFirstArg: map[string]Result{
		"--version": {ExitCode: 0, Stdout: []byte("garbage\n")},
	}}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "github.com")
	if status.Kind != KindNotFound {
		t.Fatalf("Kind = %q, want notFound", status.Kind)
	}
}

// TestDiscovery_ProbeOrder_VersionBeforeAuth proves D3's own three-step order: auth status is
// never even attempted when --version itself fails.
func TestDiscovery_ProbeOrder_VersionBeforeAuth(t *testing.T) {
	runner := &fakeRunner{byFirstArg: map[string]Result{
		"--version": {ExitCode: 1},
	}}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "github.com")
	if status.Kind != KindNotFound {
		t.Fatalf("Kind = %q, want notFound", status.Kind)
	}
	if runner.calls != 1 {
		t.Fatalf("runner.calls = %d, want 1 (auth status must not run when --version fails)", runner.calls)
	}
}

// --- D3's own asymmetric TTL: 5 min for "ok", 30s for anything else, both directions -----------

func TestDiscovery_OKCachedWithinFiveMinutes(t *testing.T) {
	runner := okRunner()
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, clock)

	d.Status(context.Background(), "github.com")
	clock.advance(okTTL - time.Second)
	d.Status(context.Background(), "github.com")

	if runner.calls != 2 {
		t.Fatalf("runner.calls = %d, want 2 (--version+auth, second Status served from cache)", runner.calls)
	}
}

func TestDiscovery_OKReprobesAfterFiveMinutes(t *testing.T) {
	runner := okRunner()
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, clock)

	d.Status(context.Background(), "github.com")
	clock.advance(okTTL + time.Second)
	d.Status(context.Background(), "github.com")

	if runner.calls != 4 {
		t.Fatalf("runner.calls = %d, want 4 (two full probes)", runner.calls)
	}
}

func TestDiscovery_NonOKCachedWithinThirtySeconds(t *testing.T) {
	runner := &fakeRunner{byFirstArg: map[string]Result{"--version": {ExitCode: 1}}}
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, clock)

	d.Status(context.Background(), "github.com")
	clock.advance(notOKTTL - time.Second)
	d.Status(context.Background(), "github.com")

	if runner.calls != 1 {
		t.Fatalf("runner.calls = %d, want 1 (second Status served from the 30s cache)", runner.calls)
	}
}

func TestDiscovery_NonOKReprobesAfterThirtySeconds(t *testing.T) {
	runner := &fakeRunner{byFirstArg: map[string]Result{"--version": {ExitCode: 1}}}
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, clock)

	d.Status(context.Background(), "github.com")
	clock.advance(notOKTTL + time.Second)
	d.Status(context.Background(), "github.com")

	if runner.calls != 2 {
		t.Fatalf("runner.calls = %d, want 2 (cache should have expired after 30s)", runner.calls)
	}
}

func TestDiscovery_DifferentHostsCacheSeparately(t *testing.T) {
	runner := okRunner()
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, runner, clock)

	d.Status(context.Background(), "github.com")
	d.Status(context.Background(), "ghes.example.com")

	if runner.calls != 4 {
		t.Fatalf("runner.calls = %d, want 4 (each host probed independently)", runner.calls)
	}
}

func TestDiscovery_HostsListsOnlyOKHosts(t *testing.T) {
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/local/bin/gh"}, okRunner(), &fakeClock{})
	d.Status(context.Background(), "github.com")
	hosts := d.Hosts(context.Background())
	if len(hosts) != 1 || hosts[0] != "github.com" {
		t.Fatalf("Hosts() = %v, want [github.com]", hosts)
	}
}

// --- platformLocator: PATH -> homebrew -> /usr/local/bin, no CLT-shim gate (D3) ----------------

func fakeStatFiles(files map[string]bool) func(string) (os.FileInfo, error) {
	return func(path string) (os.FileInfo, error) {
		if files[path] {
			return fakeExecutableFileInfo{}, nil
		}
		return nil, os.ErrNotExist
	}
}

type fakeExecutableFileInfo struct{ os.FileInfo }

func (fakeExecutableFileInfo) IsDir() bool       { return false }
func (fakeExecutableFileInfo) Mode() os.FileMode { return 0o755 }

func TestPlatformLocator_PATHWins(t *testing.T) {
	l := &platformLocator{
		lookPath: func(string) (string, error) { return "/usr/local/bin/gh", nil },
		stat:     fakeStatFiles(nil),
	}
	path, _, found := l.Locate()
	if !found || path != "/usr/local/bin/gh" {
		t.Fatalf("Locate() = (%q, _, %v), want PATH's own resolution", path, found)
	}
}

func TestPlatformLocator_HomebrewBeforeUsrLocal(t *testing.T) {
	l := &platformLocator{
		lookPath: func(string) (string, error) { return "", os.ErrNotExist },
		stat:     fakeStatFiles(map[string]bool{"/opt/homebrew/bin/gh": true, "/usr/local/bin/gh": true}),
	}
	path, probed, found := l.Locate()
	if !found || path != "/opt/homebrew/bin/gh" {
		t.Fatalf("Locate() = (%q, %v, %v), want /opt/homebrew/bin/gh", path, probed, found)
	}
}

func TestPlatformLocator_UsrLocalBinFallback(t *testing.T) {
	l := &platformLocator{
		lookPath: func(string) (string, error) { return "", os.ErrNotExist },
		stat:     fakeStatFiles(map[string]bool{"/usr/local/bin/gh": true}),
	}
	path, _, found := l.Locate()
	if !found || path != "/usr/local/bin/gh" {
		t.Fatalf("Locate() = (%q, _, %v), want /usr/local/bin/gh", path, found)
	}
}

func TestPlatformLocator_NotFoundListsEveryStep(t *testing.T) {
	l := &platformLocator{
		lookPath: func(string) (string, error) { return "", os.ErrNotExist },
		stat:     fakeStatFiles(nil),
	}
	_, probed, found := l.Locate()
	if found {
		t.Fatal("Locate() found something with every candidate stubbed absent")
	}
	// PATH, homebrew, usr/local = 3 entries — no CLT-shim step (D3).
	if len(probed) != 3 {
		t.Fatalf("probed = %v, want 3 entries (one per probe step, no CLT-shim gate)", probed)
	}
}
