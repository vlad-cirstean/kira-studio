package gitvsix

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// recordedRun captures exactly the argv Install spawned, element by element — the argv-only
// guarantee D13 makes checkable. A test asserting on a joined string would pass for a shell-based
// implementation too; this cannot.
type recordedRun struct {
	path string
	args []string
}

// fakeFileInfo is the minimal os.FileInfo a test needs to fake isExecutable's own check (D13's
// seam: Stat, not a real filesystem, for the "code" candidates that aren't the real .vsix path).
type fakeFileInfo struct{ mode os.FileMode }

func (f fakeFileInfo) Name() string       { return "fake" }
func (f fakeFileInfo) Size() int64        { return 0 }
func (f fakeFileInfo) Mode() os.FileMode  { return f.mode }
func (f fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (f fakeFileInfo) IsDir() bool        { return false }
func (f fakeFileInfo) Sys() any           { return nil }

// newInstaller builds an Installer over a real t.TempDir() executable/.vsix layout (D13's "a real
// os.Stat over a t.TempDir()" seam) and a fake LookPath: codeMode selects what `code` resolution
// looks like — "path" (LookPath succeeds), "" (found nowhere), or an absolute candidate path (
// found only at that absolute step, exercising the non-PATH probe order).
func newInstaller(t *testing.T, vsixExists bool, codeMode string, run func(context.Context, string, []string) error) (*Installer, string) {
	t.Helper()
	exeDir := t.TempDir()
	exe := filepath.Join(exeDir, "MacOS", "Kira Studio")
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, []byte{}, 0o755); err != nil {
		t.Fatal(err)
	}
	vsixPath := filepath.Join(exeDir, "Resources", vsixFileName)
	if vsixExists {
		if err := os.MkdirAll(filepath.Dir(vsixPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(vsixPath, []byte("PK\x03\x04"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	lookPath := func(name string) (string, error) {
		switch name {
		case "code":
			if codeMode == "path" {
				return "/usr/bin/code", nil
			}
			return "", errors.New("not found")
		case "open":
			return "/usr/bin/open", nil
		default:
			return "", errors.New("not found")
		}
	}
	stat := func(path string) (os.FileInfo, error) {
		if vsixExists && path == vsixPath {
			return fakeFileInfo{mode: 0o644}, nil
		}
		if codeMode != "" && codeMode != "path" && path == codeMode {
			return fakeFileInfo{mode: 0o755}, nil
		}
		return nil, os.ErrNotExist
	}

	inst := New(Deps{
		Executable: func() (string, error) { return exe, nil },
		LookPath:   lookPath,
		Stat:       stat,
		Run:        run,
	})
	return inst, vsixPath
}

func TestInstall_CodeOnPath_Installed(t *testing.T) {
	var recorded []recordedRun
	inst, vsixPath := newInstaller(t, true, "path", func(_ context.Context, path string, args []string) error {
		recorded = append(recorded, recordedRun{path, args})
		return nil
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeInstalled {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeInstalled)
	}
	if len(recorded) != 1 {
		t.Fatalf("recorded %d spawns, want 1", len(recorded))
	}
	got := recorded[0]
	if got.path != "/usr/bin/code" {
		t.Errorf("spawned path = %q, want /usr/bin/code", got.path)
	}
	wantArgs := []string{"--install-extension", vsixPath, "--force"}
	if len(got.args) != len(wantArgs) {
		t.Fatalf("args = %#v, want %#v", got.args, wantArgs)
	}
	for i, w := range wantArgs {
		if got.args[i] != w {
			t.Errorf("args[%d] = %q, want %q", i, got.args[i], w)
		}
	}
}

// TestInstall_VsixPathWithSpace_SurvivesAsOneArgvElement is D13's own stated risk made concrete:
// the app's own executable is literally "Contents/MacOS/Kira Studio", space included.
func TestInstall_VsixPathWithSpace_SurvivesAsOneArgvElement(t *testing.T) {
	exeDir := t.TempDir()
	exe := filepath.Join(exeDir, "Kira Studio.app", "Contents", "MacOS", "Kira Studio")
	if err := os.MkdirAll(filepath.Dir(exe), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, []byte{}, 0o755); err != nil {
		t.Fatal(err)
	}
	resourcesDir := filepath.Join(exeDir, "Kira Studio.app", "Contents", "Resources")
	if err := os.MkdirAll(resourcesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	vsixPath := filepath.Join(resourcesDir, vsixFileName)
	if err := os.WriteFile(vsixPath, []byte("PK\x03\x04"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(vsixPath, " ") {
		t.Fatalf("test setup is not exercising the space case: %q has no space", vsixPath)
	}

	var recorded []recordedRun
	inst := New(Deps{
		Executable: func() (string, error) { return exe, nil },
		LookPath:   func(string) (string, error) { return "/usr/bin/code", nil },
		Stat:       os.Stat,
		Run: func(_ context.Context, path string, args []string) error {
			recorded = append(recorded, recordedRun{path, args})
			return nil
		},
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeInstalled {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeInstalled)
	}
	if len(recorded) != 1 || len(recorded[0].args) != 3 {
		t.Fatalf("recorded = %#v", recorded)
	}
	if recorded[0].args[1] != vsixPath {
		t.Errorf("args[1] = %q, want %q (one element, space intact)", recorded[0].args[1], vsixPath)
	}
}

func TestInstall_CodeMissingEverywhere_Revealed(t *testing.T) {
	var recorded []recordedRun
	inst, vsixPath := newInstaller(t, true, "", func(_ context.Context, path string, args []string) error {
		recorded = append(recorded, recordedRun{path, args})
		return nil
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeRevealed {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeRevealed)
	}
	if len(recorded) != 1 {
		t.Fatalf("recorded %d spawns, want 1", len(recorded))
	}
	if recorded[0].path != "/usr/bin/open" {
		t.Errorf("spawned path = %q, want /usr/bin/open", recorded[0].path)
	}
	wantArgs := []string{"-R", vsixPath}
	if len(recorded[0].args) != len(wantArgs) || recorded[0].args[0] != wantArgs[0] || recorded[0].args[1] != wantArgs[1] {
		t.Errorf("args = %#v, want %#v", recorded[0].args, wantArgs)
	}

	wantProbed := []string{
		"code (on PATH)",
		"/usr/local/bin/code",
		"/opt/homebrew/bin/code",
		"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
	}
	if len(result.Probed) < len(wantProbed) {
		t.Fatalf("Probed = %#v, want at least %d entries", result.Probed, len(wantProbed))
	}
	for i, w := range wantProbed {
		if result.Probed[i] != w {
			t.Errorf("Probed[%d] = %q, want %q", i, result.Probed[i], w)
		}
	}
}

func TestInstall_CodeFound_ExitsNonZero_InstallFailed_NoReveal(t *testing.T) {
	var recorded []recordedRun
	inst, _ := newInstaller(t, true, "path", func(_ context.Context, path string, args []string) error {
		recorded = append(recorded, recordedRun{path, args})
		return &RunError{ExitCode: 1, Stderr: "unknown extension"}
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeInstallFailed {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeInstallFailed)
	}
	if result.Detail == "" {
		t.Error("Detail is empty, want a non-empty single-line reason")
	}
	if strings.Contains(result.Detail, "\n") {
		t.Errorf("Detail = %q, want a single line", result.Detail)
	}
	if len(recorded) != 1 {
		t.Fatalf("recorded %d spawns, want exactly 1 (no fallthrough to reveal)", len(recorded))
	}
}

func TestInstall_CodeMissing_RevealAlsoFails_RevealFailed(t *testing.T) {
	inst, _ := newInstaller(t, true, "", func(_ context.Context, path string, args []string) error {
		return &RunError{ExitCode: 1, Stderr: "no such file"}
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeRevealFailed {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeRevealFailed)
	}
	if result.Detail == "" {
		t.Error("Detail is empty, want a non-empty reason")
	}
}

func TestInstall_NoVsixBesideExecutable_NotBundled_NoSpawn(t *testing.T) {
	spawned := false
	inst, _ := newInstaller(t, false, "path", func(_ context.Context, path string, args []string) error {
		spawned = true
		return nil
	})

	result := inst.Install(context.Background())
	if result.Outcome != OutcomeNotBundled {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeNotBundled)
	}
	if spawned {
		t.Error("a spawn was recorded for a not-bundled .vsix — Install must not spawn anything")
	}
}

// TestLocateCode_CandidateExistsButNotExecutable_Skipped proves the same isExecutable-equivalent
// behaviour gitclient/discovery.go's own locator relies on: a candidate that exists but carries no
// executable bit is not selected.
func TestLocateCode_CandidateExistsButNotExecutable_Skipped(t *testing.T) {
	nonExecPath := "/usr/local/bin/code"
	stat := func(path string) (os.FileInfo, error) {
		if path == nonExecPath {
			return fakeFileInfo{mode: 0o644}, nil
		}
		return nil, os.ErrNotExist
	}
	inst := New(Deps{
		LookPath: func(string) (string, error) { return "", errors.New("not found") },
		Stat:     stat,
	})

	_, probed, found := inst.locateCode()
	if found {
		t.Fatal("locateCode reported found for a non-executable candidate")
	}
	if len(probed) == 0 || probed[0] != "code (on PATH)" {
		t.Errorf("probed[0] = %#v, want the PATH miss recorded first", probed)
	}
}
