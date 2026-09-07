package gitclient

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestClassify_Success(t *testing.T) {
	if err := Classify(context.Background(), []string{"status"}, Result{ExitCode: 0}, nil); err != nil {
		t.Fatalf("Classify(ok) = %v, want nil", err)
	}
}

func TestClassify_NotARepository(t *testing.T) {
	res := Result{ExitCode: 128, Stderr: []byte("fatal: not a git repository (or any of the parent directories): .git\n")}
	err := Classify(context.Background(), []string{"rev-parse"}, res, nil)
	kind, ok := KindOf(err)
	if !ok || kind != KindNotARepository {
		t.Fatalf("KindOf = (%v, %v), want (%v, true)", kind, ok, KindNotARepository)
	}
}

func TestClassify_PermissionDenied(t *testing.T) {
	res := Result{ExitCode: 128, Stderr: []byte("error: cannot open .git/index: Permission denied\n")}
	err := Classify(context.Background(), []string{"status"}, res, nil)
	kind, _ := KindOf(err)
	if kind != KindPermissionDenied {
		t.Fatalf("KindOf = %v, want %v", kind, KindPermissionDenied)
	}
}

func TestClassify_UnknownFallsThrough(t *testing.T) {
	res := Result{ExitCode: 1, Stderr: []byte("fatal: something this package has never seen\n")}
	err := Classify(context.Background(), []string{"status"}, res, nil)
	kind, _ := KindOf(err)
	if kind != KindUnknown {
		t.Fatalf("KindOf = %v, want %v", kind, KindUnknown)
	}
	want := "git status failed (unknown): fatal: something this package has never seen"
	if err.Error() != want {
		t.Fatalf("Error() = %q, want %q", err.Error(), want)
	}
}

// TestError_SummaryIsFirstNonEmptyStderrLine proves the whole stderr wall never crosses (D6) — a
// multi-line stderr summarises to its first non-empty line; Stderr itself keeps everything.
func TestError_SummaryIsFirstNonEmptyStderrLine(t *testing.T) {
	res := Result{ExitCode: 1, Stderr: []byte("\nerror: hook declined\nremote: see https://example\n")}
	err := Classify(context.Background(), []string{"push"}, res, nil).(*Error)
	want := "git push failed (unknown): error: hook declined"
	if err.Error() != want {
		t.Fatalf("Error() = %q, want %q", err.Error(), want)
	}
	if err.Stderr != "error: hook declined\nremote: see https://example" {
		t.Fatalf("Stderr = %q, want the full trimmed stderr preserved on the struct", err.Stderr)
	}
}

// TestError_SummaryFallsBackToExitCodeWhenStderrEmpty covers D6's other named case: a nonzero exit
// with no stderr at all still produces a useful one-liner.
func TestError_SummaryFallsBackToExitCodeWhenStderrEmpty(t *testing.T) {
	res := Result{ExitCode: 2}
	err := Classify(context.Background(), []string{"merge-tree"}, res, nil).(*Error)
	want := "git merge-tree failed (unknown): exited 2"
	if err.Error() != want {
		t.Fatalf("Error() = %q, want %q", err.Error(), want)
	}
}

func TestClassify_CancelledBeforeExitCode(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Even a Result claiming success must classify as cancelled once ctx says so — a killed
	// process can leave an arbitrary ExitCode behind, and ctx is the authority (mirrors
	// httpclient's classifySendErr checking sendCtx.Err() first).
	err := Classify(ctx, []string{"log"}, Result{ExitCode: 0}, nil)
	kind, ok := KindOf(err)
	if !ok || kind != KindCancelled {
		t.Fatalf("KindOf = (%v, %v), want (%v, true)", kind, ok, KindCancelled)
	}
}

func TestClassify_DeadlineExceeded(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 0)
	defer cancel()
	<-ctx.Done()
	err := Classify(ctx, []string{"log"}, Result{}, nil)
	kind, _ := KindOf(err)
	if kind != KindTimeout {
		t.Fatalf("KindOf = %v, want %v", kind, KindTimeout)
	}
	if !errors.Is(context.Cause(ctx), context.DeadlineExceeded) && ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("test setup: ctx.Err() = %v, want DeadlineExceeded", ctx.Err())
	}
}

func TestClassify_SpawnFailure(t *testing.T) {
	spawnErr := errors.New("exec: \"git\": executable file not found in $PATH")
	err := Classify(context.Background(), []string{"--version"}, Result{}, spawnErr)
	kind, _ := KindOf(err)
	if kind != KindUnknown {
		t.Fatalf("KindOf = %v, want %v", kind, KindUnknown)
	}
	if !errors.Is(err, spawnErr) {
		t.Fatalf("errors.Is(err, spawnErr) = false, want true (Unwrap must chain to it)")
	}
}

// Just documents the constant exists and is sane; not asserting a specific value beyond "not
// instant, not absurd" — this is spawn timing tolerance, not business logic.
func TestGracefulStopDelay_IsPositiveAndBounded(t *testing.T) {
	if gracefulStopDelay <= 0 || gracefulStopDelay > 10*time.Second {
		t.Fatalf("gracefulStopDelay = %v, want a small positive duration", gracefulStopDelay)
	}
}
