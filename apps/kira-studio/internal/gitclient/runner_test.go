package gitclient

import (
	"context"
	"os/exec"
	"slices"
	"testing"
)

// A test asserting the exact env and argv of a spawn is worth more than it looks (plan §5, C1's
// own rationale) — every later phase's write queue, discovery probe and porcelain parser inherits
// whatever buildEnv/buildArgv get wrong here.

func TestBuildEnv_AppendsHygieneOntoBase(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/kira"}
	got := buildEnv(base)

	want := append(slices.Clone(base), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	if !slices.Equal(got, want) {
		t.Fatalf("buildEnv(%v) = %v, want %v", base, got, want)
	}
}

func TestBuildArgv_AlwaysQuotepathFirst(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"status"}})
	want := []string{"-c", "core.quotepath=false", "status"}
	if !slices.Equal(got, want) {
		t.Fatalf("buildArgv = %v, want %v", got, want)
	}
}

func TestBuildArgv_ReadOnlyAddsNoOptionalLocks(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"log"}, ReadOnly: true})
	want := []string{"-c", "core.quotepath=false", "--no-optional-locks", "log"}
	if !slices.Equal(got, want) {
		t.Fatalf("buildArgv(ReadOnly) = %v, want %v", got, want)
	}
}

func TestBuildArgv_WriteOmitsNoOptionalLocks(t *testing.T) {
	got := buildArgv(Spec{Args: []string{"commit"}, ReadOnly: false})
	for _, a := range got {
		if a == "--no-optional-locks" {
			t.Fatalf("buildArgv(ReadOnly: false) = %v, must not carry --no-optional-locks", got)
		}
	}
}

// TestExecRunner_Run is the one place this package spawns a real process — skipped when no git is
// on the test machine's PATH rather than faking exec.Cmd, since the point is to prove
// execRunner's own env/argv assembly reaches a real child correctly, which a fake cannot show.
func TestExecRunner_Run(t *testing.T) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	r := NewExecRunner()

	t.Run("ok exit", func(t *testing.T) {
		res, err := r.Run(context.Background(), gitPath, Spec{Args: []string{"--version"}})
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if res.ExitCode != 0 {
			t.Fatalf("ExitCode = %d, want 0 (stderr: %s)", res.ExitCode, res.Stderr)
		}
		if len(res.Stdout) == 0 {
			t.Fatalf("Stdout is empty, want a version string")
		}
	})

	t.Run("nonzero exit is not a Go error", func(t *testing.T) {
		res, err := r.Run(context.Background(), gitPath, Spec{Args: []string{"not-a-real-subcommand"}})
		if err != nil {
			t.Fatalf("Run: %v, want nil error with ExitCode carrying the failure", err)
		}
		if res.ExitCode == 0 {
			t.Fatalf("ExitCode = 0, want non-zero for an unknown subcommand")
		}
	})

	t.Run("context cancellation stops the process", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := r.Run(ctx, gitPath, Spec{Args: []string{"--version"}})
		if err == nil {
			t.Fatalf("Run with an already-cancelled context: want an error")
		}
	})

	t.Run("missing binary reports an error, not a panic", func(t *testing.T) {
		_, err := r.Run(context.Background(), "/no/such/git-binary", Spec{Args: []string{"--version"}})
		if err == nil {
			t.Fatalf("Run with a missing binary: want an error")
		}
	})
}
