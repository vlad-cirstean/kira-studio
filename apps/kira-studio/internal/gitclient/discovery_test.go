package gitclient

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// --- fakes shared by this file -------------------------------------------------------------

type fakeLocator struct {
	path   string
	probed []string
	found  bool
}

func (f fakeLocator) Locate(string) (string, []string, bool) { return f.path, f.probed, f.found }

type fakeRunner struct {
	// keyed by the joined Args, so a test can script different output per subcommand if needed.
	result Result
	err    error
	calls  int
}

func (f *fakeRunner) Run(ctx context.Context, gitPath string, spec Spec) (Result, error) {
	f.calls++
	return f.result, f.err
}

type fakeClock struct{ now time.Time }

func (f *fakeClock) Now() time.Time          { return f.now }
func (f *fakeClock) advance(d time.Duration) { f.now = f.now.Add(d) }

// --- parseGitVersion / versionLess -----------------------------------------------------------

func TestParseGitVersion(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		wantOk bool
	}{
		{"git version 2.42.0\n", "2.42.0", true},
		{"git version 2.42.0 (Apple Git-135)\n", "2.42.0", true},
		{"not git output at all\n", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := parseGitVersion(c.in)
		if got != c.want || ok != c.wantOk {
			t.Errorf("parseGitVersion(%q) = (%q, %v), want (%q, %v)", c.in, got, ok, c.want, c.wantOk)
		}
	}
}

func TestVersionLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"2.37.9", "2.38.0", true},
		{"2.38.0", "2.38.0", false},
		{"2.39.0", "2.38.0", false},
		{"2.38.0.windows.1", "2.38.0", false},
		{"1.9.9", "2.38.0", true},
	}
	for _, c := range cases {
		if got := versionLess(c.a, c.b); got != c.want {
			t.Errorf("versionLess(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// --- Discovery.Status: classification ---------------------------------------------------------

func TestDiscovery_NotFound(t *testing.T) {
	d := NewDiscovery(fakeLocator{found: false, probed: []string{"a", "b"}}, &fakeRunner{}, &fakeClock{})
	status := d.Status(context.Background(), "")
	if status.Kind != "notFound" {
		t.Fatalf("Kind = %q, want notFound", status.Kind)
	}
	if len(status.Probed) != 2 {
		t.Fatalf("Probed = %v, want the locator's own list", status.Probed)
	}
}

func TestDiscovery_TooOld(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("git version 2.30.1\n")}}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "")
	if status.Kind != "tooOld" {
		t.Fatalf("Kind = %q, want tooOld", status.Kind)
	}
	if status.Detected != "2.30.1" || status.Required != RequiredVersion || status.SettingID != GitPathSettingID {
		t.Fatalf("status = %+v, want detected/required/settingId populated", status)
	}
}

func TestDiscovery_OK(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("git version 2.42.0\n")}}
	d := NewDiscovery(fakeLocator{found: true, path: "/opt/homebrew/bin/git"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "")
	if status.Kind != "ok" || status.Version != "2.42.0" || status.Path != "/opt/homebrew/bin/git" {
		t.Fatalf("status = %+v, want ok/2.42.0/opt/homebrew/bin/git", status)
	}
}

func TestDiscovery_UnusableOnSpawnFailure(t *testing.T) {
	runner := &fakeRunner{err: errors.New("permission denied")}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "")
	if status.Kind != "unusable" || status.Reason == "" {
		t.Fatalf("status = %+v, want unusable with a reason", status)
	}
}

func TestDiscovery_UnusableOnUnparseableVersion(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("garbage\n")}}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, &fakeClock{})
	status := d.Status(context.Background(), "")
	if status.Kind != "unusable" {
		t.Fatalf("Kind = %q, want unusable", status.Kind)
	}
}

// --- Discovery.Status: TTL caching, via the fake Clock (D2) ------------------------------------

func TestDiscovery_CachesWithinTTL(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("git version 2.42.0\n")}}
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, clock)

	d.Status(context.Background(), "")
	clock.advance(discoveryTTL - time.Second)
	d.Status(context.Background(), "")

	if runner.calls != 1 {
		t.Fatalf("runner.calls = %d, want 1 (second call should be served from cache)", runner.calls)
	}
}

func TestDiscovery_ReprobesAfterTTL(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("git version 2.42.0\n")}}
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, clock)

	d.Status(context.Background(), "")
	clock.advance(discoveryTTL + time.Second)
	d.Status(context.Background(), "")

	if runner.calls != 2 {
		t.Fatalf("runner.calls = %d, want 2 (cache should have expired)", runner.calls)
	}
}

func TestDiscovery_ConfiguredPathChangeBypassesCache(t *testing.T) {
	runner := &fakeRunner{result: Result{ExitCode: 0, Stdout: []byte("git version 2.42.0\n")}}
	clock := &fakeClock{}
	d := NewDiscovery(fakeLocator{found: true, path: "/usr/bin/git"}, runner, clock)

	d.Status(context.Background(), "/a/git")
	d.Status(context.Background(), "/b/git")

	if runner.calls != 2 {
		t.Fatalf("runner.calls = %d, want 2 (a changed git.path must not reuse the old cache)", runner.calls)
	}
}

// --- darwinLocator: the probe order and the Command Line Tools gate (D3) -----------------------

func fakeStat(files map[string]bool) func(string) (os.FileInfo, error) {
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

func TestDarwinLocator_ConfiguredPathWins(t *testing.T) {
	l := &darwinLocator{
		lookPath:      func(string) (string, error) { return "", os.ErrNotExist },
		stat:          fakeStat(map[string]bool{"/custom/git": true}),
		cltsInstalled: func() bool { return true },
	}
	path, _, found := l.Locate("/custom/git")
	if !found || path != "/custom/git" {
		t.Fatalf("Locate(configured) = (%q, _, %v), want (/custom/git, _, true)", path, found)
	}
}

func TestDarwinLocator_PATHWins(t *testing.T) {
	l := &darwinLocator{
		lookPath:      func(string) (string, error) { return "/usr/local/bin/git", nil },
		stat:          fakeStat(nil),
		cltsInstalled: func() bool { return true },
	}
	path, probed, found := l.Locate("")
	if !found || path != "/usr/local/bin/git" {
		t.Fatalf("Locate = (%q, %v, %v), want PATH's own resolution", path, probed, found)
	}
}

func TestDarwinLocator_PATHResolvingToShimDoesNotShortCircuit(t *testing.T) {
	// The trap this whole locator exists to avoid: LookPath("git") landing on the Command Line
	// Tools shim must NOT be accepted at the PATH step — it must fall through to the final,
	// gated step instead.
	cltsChecked := false
	l := &darwinLocator{
		lookPath: func(string) (string, error) { return "/usr/bin/git", nil },
		stat:     fakeStat(map[string]bool{"/usr/bin/git": true}),
		cltsInstalled: func() bool {
			cltsChecked = true
			return true
		},
	}
	path, _, found := l.Locate("")
	if !found || path != "/usr/bin/git" {
		t.Fatalf("Locate = (%q, _, %v), want the shim resolved via the gated final step", path, found)
	}
	if !cltsChecked {
		t.Fatal("cltsInstalled was never consulted — the PATH hit on the shim short-circuited the gate")
	}
}

func TestDarwinLocator_NeverStatsShimWhenCLToolsMissing(t *testing.T) {
	// D3's actual safety property: when Command Line Tools are not installed, isExecutable must
	// never even be asked about /usr/bin/git — asking (a stat) is harmless, but this proves the
	// gate is checked BEFORE any attempt to touch that path at all, matching the plan's "probe
	// xcode-select -p first and never spawn the shim blind."
	statCalls := []string{}
	l := &darwinLocator{
		lookPath: func(string) (string, error) { return "", os.ErrNotExist },
		stat: func(path string) (os.FileInfo, error) {
			statCalls = append(statCalls, path)
			return nil, os.ErrNotExist
		},
		cltsInstalled: func() bool { return false },
	}
	_, probed, found := l.Locate("")
	if found {
		t.Fatal("Locate found something with no candidate ever satisfied")
	}
	for _, p := range statCalls {
		if p == clToolsShim {
			t.Fatalf("stat was called on %s despite Command Line Tools being reported absent", clToolsShim)
		}
	}
	last := probed[len(probed)-1]
	if last == clToolsShim {
		t.Fatalf("probed's last entry is the bare shim path %q, want it annotated as skipped", last)
	}
}

func TestDarwinLocator_HomebrewBeforeUsrLocalBeforeShim(t *testing.T) {
	l := &darwinLocator{
		lookPath:      func(string) (string, error) { return "", os.ErrNotExist },
		stat:          fakeStat(map[string]bool{"/usr/local/bin/git": true}),
		cltsInstalled: func() bool { return true },
	}
	path, probed, found := l.Locate("")
	if !found || path != "/usr/local/bin/git" {
		t.Fatalf("Locate = (%q, %v, %v), want /usr/local/bin/git", path, probed, found)
	}
	// /opt/homebrew/bin must have been probed (and missed) before /usr/local/bin was accepted.
	if len(probed) < 2 || probed[len(probed)-2] != "/opt/homebrew/bin/git" {
		t.Fatalf("probed = %v, want /opt/homebrew/bin/git probed immediately before the match", probed)
	}
}

func TestDarwinLocator_NotFoundListsEveryStepProbed(t *testing.T) {
	l := &darwinLocator{
		lookPath:      func(string) (string, error) { return "", os.ErrNotExist },
		stat:          fakeStat(nil),
		cltsInstalled: func() bool { return true },
	}
	_, probed, found := l.Locate("/configured/git")
	if found {
		t.Fatal("Locate found something with every candidate stubbed absent")
	}
	// configured, PATH, homebrew, usr/local, shim = 5 entries.
	if len(probed) != 5 {
		t.Fatalf("probed = %v, want 5 entries (one per probe step)", probed)
	}
}
