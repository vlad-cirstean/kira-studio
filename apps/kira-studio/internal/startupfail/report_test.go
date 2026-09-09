package startupfail_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/startupfail"
)

// spawnCall records one invocation of a fake Deps.Run — enough to assert what was spawned, with
// what argv, and with what stdin, without any real subprocess ever running (this whole file runs
// on Linux, where /usr/bin/osascript does not exist).
type spawnCall struct {
	path  string
	args  []string
	stdin []byte
}

func notFound(string) (string, error)     { return "", errors.New("not found") }
func notStat(string) (os.FileInfo, error) { return nil, os.ErrNotExist }
func fixedNow() time.Time                 { return time.Unix(1_700_000_000, 0) }

// (a) osascript absent (LookPath and Stat both fail): no spawn is attempted, and the stderr write
// still happens — D2's ordering holds even when the alert cannot be shown at all.
func TestReportOsascriptAbsent(t *testing.T) {
	var calls []spawnCall
	var stderrBuf bytes.Buffer
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: notFound,
		Stat:     notStat,
		Run: func(_ context.Context, path string, args []string, stdin []byte) (string, error) {
			calls = append(calls, spawnCall{path, args, stdin})
			return "", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &stderrBuf,
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	r.Report(startupfail.StepEnsureLayout, errors.New("disk full"))

	if len(calls) != 0 {
		t.Fatalf("expected zero spawns when osascript is absent, got %d: %#v", len(calls), calls)
	}
	if stderrBuf.Len() == 0 {
		t.Fatal("expected the stderr write to happen even when osascript is absent")
	}
	if !strings.Contains(stderrBuf.String(), "couldn't create its data folder") {
		t.Fatalf("stderr did not contain the rendered message: %q", stderrBuf.String())
	}
}

// (b) osascript present: exactly one spawn, with osascript's own path and the expected argv —
// title/body matching what RenderAlert(Classify(...)) independently produces for the same step
// and error.
func TestReportOsascriptPresentSpawnsExpectedArgv(t *testing.T) {
	var calls []spawnCall
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) {
			if name == "osascript" {
				return "/usr/bin/osascript", nil
			}
			return "", errors.New("not found")
		},
		Run: func(_ context.Context, path string, args []string, stdin []byte) (string, error) {
			calls = append(calls, spawnCall{path, append([]string(nil), args...), stdin})
			return "OK", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	err := errors.New("prepare failed: boom")
	r.Report(startupfail.StepRepos, err)

	if len(calls) != 1 {
		t.Fatalf("expected exactly one spawn, got %d: %#v", len(calls), calls)
	}
	call := calls[0]
	if call.path != "/usr/bin/osascript" {
		t.Fatalf("spawned %q, want /usr/bin/osascript", call.path)
	}
	wantTitle, wantBody := startupfail.RenderAlert(startupfail.Classify(startupfail.StepRepos, err))
	if len(call.args) < 3 {
		t.Fatalf("argv too short: %#v", call.args)
	}
	if call.args[0] != "-e" {
		t.Fatalf("argv[0] = %q, want \"-e\"", call.args[0])
	}
	if call.args[len(call.args)-3] != "--" {
		t.Fatalf("argv[-3] = %q, want \"--\"", call.args[len(call.args)-3])
	}
	if call.args[len(call.args)-2] != wantTitle {
		t.Fatalf("argv title = %q, want %q", call.args[len(call.args)-2], wantTitle)
	}
	if call.args[len(call.args)-1] != wantBody {
		t.Fatalf("argv body = %q, want %q", call.args[len(call.args)-1], wantBody)
	}
}

// (c) "Copy Details" pressed: a second spawn, of pbcopy, whose stdin is exactly the clipboard
// payload RenderClipboard would independently produce for the same step and error.
func TestReportCopyDetailsSpawnsPbcopyWithClipboardPayload(t *testing.T) {
	var calls []spawnCall
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) {
			switch name {
			case "osascript":
				return "/usr/bin/osascript", nil
			case "pbcopy":
				return "/usr/bin/pbcopy", nil
			}
			return "", errors.New("not found")
		},
		Run: func(_ context.Context, path string, args []string, stdin []byte) (string, error) {
			calls = append(calls, spawnCall{path, append([]string(nil), args...), append([]byte(nil), stdin...)})
			if strings.Contains(path, "osascript") {
				return "Copy Details", nil
			}
			return "", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	err := errors.New("read settings: unique-clipboard-marker-7f2a")
	r.Report(startupfail.StepSettings, err)

	if len(calls) != 2 {
		t.Fatalf("expected exactly two spawns (osascript then pbcopy), got %d: %#v", len(calls), calls)
	}
	pb := calls[1]
	if !strings.Contains(pb.path, "pbcopy") {
		t.Fatalf("second spawn was %q, want pbcopy", pb.path)
	}
	if pb.args != nil {
		t.Fatalf("pbcopy should be spawned with no argv, got %#v", pb.args)
	}
	wantPayload := startupfail.RenderClipboard(startupfail.Classify(startupfail.StepSettings, err), err)
	if string(pb.stdin) != wantPayload {
		t.Fatalf("pbcopy stdin = %q, want %q", string(pb.stdin), wantPayload)
	}
}

// (d) "OK" pressed: no second spawn.
func TestReportOKPressedNoSecondSpawn(t *testing.T) {
	var calls []spawnCall
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) {
			if name == "osascript" {
				return "/usr/bin/osascript", nil
			}
			return "", errors.New("not found")
		},
		Run: func(_ context.Context, path string, _ []string, _ []byte) (string, error) {
			calls = append(calls, spawnCall{path: path})
			return "OK", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	r.Report(startupfail.StepRepos, errors.New("boom"))

	if len(calls) != 1 {
		t.Fatalf("expected exactly one spawn when OK is pressed, got %d: %#v", len(calls), calls)
	}
}

// (e) osascript exits non-zero: no second spawn, and — the case that matters most — no panic.
func TestReportOsascriptNonZeroExitNoPanic(t *testing.T) {
	var calls []spawnCall
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) {
			if name == "osascript" {
				return "/usr/bin/osascript", nil
			}
			return "", errors.New("not found")
		},
		Run: func(_ context.Context, path string, _ []string, _ []byte) (string, error) {
			calls = append(calls, spawnCall{path: path})
			return "", errors.New("exit status 1")
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	r.Report(startupfail.StepRepos, errors.New("boom")) // must not panic

	if len(calls) != 1 {
		t.Fatalf("expected exactly one spawn (osascript only), got %d: %#v", len(calls), calls)
	}
}

// (f) KIRA_NO_STARTUP_ALERT set: zero spawns at all, but the stderr write still happens — D9's
// escape hatch skips only step (3), never steps (1)/(2).
func TestReportEnvVarDisablesAlert(t *testing.T) {
	var calls []spawnCall
	var stderrBuf bytes.Buffer
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		Run: func(_ context.Context, path string, _ []string, _ []byte) (string, error) {
			calls = append(calls, spawnCall{path: path})
			return "", nil
		},
		Getenv: func(key string) string {
			if key == "KIRA_NO_STARTUP_ALERT" {
				return "1"
			}
			return ""
		},
		Stderr: &stderrBuf,
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	r.Report(startupfail.StepRepos, errors.New("boom"))

	if len(calls) != 0 {
		t.Fatalf("expected zero spawns with KIRA_NO_STARTUP_ALERT set, got %d: %#v", len(calls), calls)
	}
	if stderrBuf.Len() == 0 {
		t.Fatal("expected the stderr write to still happen with the alert disabled")
	}
}

// TestReportAlertOnceAtMostOneSpawnPerReporter proves D7's "at most one alert per process" bound:
// two Report calls on the same Reporter only ever spawn osascript once.
func TestReportAlertOnceAtMostOneSpawnPerReporter(t *testing.T) {
	var osascriptSpawns int
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: func(name string) (string, error) {
			if name == "osascript" {
				return "/usr/bin/osascript", nil
			}
			return "", errors.New("not found")
		},
		Run: func(_ context.Context, path string, _ []string, _ []byte) (string, error) {
			if strings.Contains(path, "osascript") {
				osascriptSpawns++
			}
			return "OK", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log:    func(string, ...any) {},
		Now:    fixedNow,
	})

	r.Report(startupfail.StepRepos, errors.New("first"))
	r.Report(startupfail.StepSettings, errors.New("second"))

	if osascriptSpawns != 1 {
		t.Fatalf("expected exactly one osascript spawn across two Report calls, got %d", osascriptSpawns)
	}
}

// TestReportLogsBeforeStderr confirms the Log seam is actually invoked with the classified
// headline and the step — D2's ordering starts here regardless of whether the alert can ever be
// shown.
func TestReportLogsHeadlineAndStep(t *testing.T) {
	var loggedMsg string
	var loggedArgs []any
	r := startupfail.NewReporter(startupfail.Deps{
		LookPath: notFound,
		Stat:     notStat,
		Run: func(_ context.Context, _ string, _ []string, _ []byte) (string, error) {
			return "", nil
		},
		Getenv: func(string) string { return "" },
		Stderr: &bytes.Buffer{},
		Log: func(msg string, args ...any) {
			loggedMsg = msg
			loggedArgs = args
		},
		Now: fixedNow,
	})

	r.Report(startupfail.StepLogging, errors.New("boom"))

	if loggedMsg != "Kira Studio couldn't open its log folder." {
		t.Fatalf("logged headline = %q", loggedMsg)
	}
	found := false
	for i := 0; i+1 < len(loggedArgs); i += 2 {
		if loggedArgs[i] == "step" && loggedArgs[i+1] == string(startupfail.StepLogging) {
			found = true
		}
	}
	if !found {
		t.Fatalf("logged args did not include step=%q: %#v", startupfail.StepLogging, loggedArgs)
	}
}
