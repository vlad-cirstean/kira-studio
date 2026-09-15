package codeparse

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// largeGoSource returns a synthetic Go file with n trivial functions — big enough that a parse
// takes measurable time, so a context cancelled shortly after the call starts has a real chance
// of landing mid-parse rather than before or after it.
func largeGoSource(n int) []byte {
	var b strings.Builder
	b.WriteString("package generated\n\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "func f%d(a, b int) int {\n\tx := a + b\n\tfor i := 0; i < x; i++ {\n\t\tx += i\n\t}\n\treturn x\n}\n\n", i)
	}
	return []byte(b.String())
}

// TestParseCancelledContextReturnsError is Group 0's deterministic case: a context that is
// already Done before the parse starts must make ParseWithOptions' ProgressCallback fire true on
// its very first check, so the parse is cancelled from inside the (synchronous) parse call — no
// goroutine outlives it, and Parse must surface ctx.Err() as a real error rather than
// (Result{}, nil).
func TestParseCancelledContextReturnsError(t *testing.T) {
	s := NewSession()
	defer s.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already done before Parse is even called

	result, err := s.Parse(ctx, "big.go", largeGoSource(500), Go)
	if err == nil {
		t.Fatal("Parse with an already-cancelled context returned a nil error — a nil tree must never read as success")
	}
	if result.Symbols != nil || result.References != nil {
		t.Fatalf("Parse returned a populated Result alongside an error: %+v", result)
	}
}

// TestReparseCancelledContextReturnsError mirrors the above for the incremental path: a resident
// tree exists, but the follow-up parse's context is already cancelled.
func TestReparseCancelledContextReturnsError(t *testing.T) {
	s := NewSession()
	defer s.Close()

	src := largeGoSource(500)
	if _, err := s.Parse(context.Background(), "big.go", src, Go); err != nil {
		t.Fatalf("seeding Parse failed: %v", err)
	}

	edited := append(append([]byte{}, src...), []byte("\nfunc extra() {}\n")...)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result, err := s.Reparse(ctx, "big.go", edited, Go)
	if err == nil {
		t.Fatal("Reparse with an already-cancelled context returned a nil error — a nil tree must never read as success")
	}
	if result.Symbols != nil || result.References != nil {
		t.Fatalf("Reparse returned a populated Result alongside an error: %+v", result)
	}
}

// TestParseConcurrentCancellationDoesNotCrash is Group 0's own repro shape: many goroutines
// racing Parse/Reparse against contexts cancelled mid-flight, on a Session whose parser pool
// recycles parsers across callers exactly as codeindex's sync workers do. It guards two distinct
// process-killing failure modes found in two consecutive phases:
//
//   - Before the ParseWithOptions fix (P69, b412286b), go-tree-sitter's deprecated ParseCtx
//     spawned a goroutine that wrote to a NULL CancellationFlag on cancellation — a guaranteed,
//     uncatchable SIGSEGV (reproduced by the review round roughly 30-40% of the time under
//     -count=15).
//   - After that fix but before P69c, a parse cancelled during tree-sitter's internal balancing
//     phase left canceled_balancing set with no public API to clear it; checkinParser's own
//     Reset() did not touch that flag, so the poisoned parser went back into the pool and the
//     next parse on it hit ts_assert(self->finished_tree.ptr) and SIGABRT'd — deterministic given
//     the cancellation phase, not a race (docs/v1.6/plans/P69c-codeparse-cancel-crash.md §2).
//
// There is nothing to assert beyond "the test binary survives": a crash here means the process is
// gone, not a failed assertion. Run with -race and a high -count (per CLAUDE.md's own instructions
// for this package) for real confidence.
func TestParseConcurrentCancellationDoesNotCrash(t *testing.T) {
	s := NewSession()
	defer s.Close()

	src := largeGoSource(300)

	const workers = 8
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func(w int) {
			defer wg.Done()
			path := fmt.Sprintf("file%d.go", w)
			for i := 0; i < 20; i++ {
				// A short-lived timeout races cancellation against the parse itself — some
				// iterations finish first, some get cancelled mid-parse, both are fine as long
				// as neither crashes nor reports a poisoned nil-error success.
				ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
				result, err := s.Parse(ctx, path, src, Go)
				cancel()
				if err == nil && result.Symbols == nil && result.References == nil {
					t.Errorf("worker %d iter %d: nil error with an empty Result — possible poisoned success", w, i)
				}
			}
		}(w)
	}
	wg.Wait()
}

// TestParseAfterCancelledParseIsCorrect catches what
// TestParseConcurrentCancellationDoesNotCrash cannot: a resumed parse silently returning the
// wrong tree instead of crashing (docs/v1.6/plans/P69c-codeparse-cancel-crash.md §2.5 — measured
// 416/456 wrong-tree outcomes for the "drop Reset(), reuse anyway" fix that was rejected because
// it trades a loud crash for silent corruption). It parses a small baseline file once to fix an
// expected answer, sweeps a cancellation deadline across the full duration of a large parse so
// cancellation lands everywhere from the first checkpoint through the balancing phase, and after
// every single sweep step — cancelled or not — re-parses the baseline file on the same Session
// and asserts it still gets the right answer.
func TestParseAfterCancelledParseIsCorrect(t *testing.T) {
	s := NewSession()
	defer s.Close()

	const smallPath = "small.go"
	small := []byte("package small\n\nfunc Small() int {\n\treturn 1\n}\n\nfunc Other() int {\n\treturn 2\n}\n")

	baseline, err := s.Parse(context.Background(), smallPath, small, Go)
	if err != nil {
		t.Fatalf("baseline Parse of the small file failed: %v", err)
	}
	if baseline.HasError {
		t.Fatal("baseline parse of the small file has ERROR nodes — fixture is broken")
	}
	expectedSymbols := len(baseline.Symbols)
	expectedLines := baseline.LineCount
	if expectedSymbols == 0 {
		t.Fatal("baseline parse found zero symbols — fixture is broken")
	}

	const largePath = "large.go"
	large := largeGoSource(300)

	start := time.Now()
	if _, err := s.Parse(context.Background(), largePath, large, Go); err != nil {
		t.Fatalf("timing Parse of the large file failed: %v", err)
	}
	fullDuration := time.Since(start)
	if fullDuration <= 0 {
		t.Fatal("timing Parse of the large file took no measurable time — cannot sweep a deadline across it")
	}

	const steps = 200
	cancelled := 0
	for i := 0; i < steps; i++ {
		// Sweep the deadline from near-zero to the full uncancelled duration, so cancellation
		// lands everywhere from the very first progress checkpoint (parse loop) through the
		// balancing phase — not just "immediately", which would only exercise one phase.
		timeout := time.Duration(i+1) * fullDuration / steps
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		_, parseErr := s.Parse(ctx, largePath, large, Go)
		cancel()
		if parseErr != nil {
			cancelled++
		}

		// Regardless of whether this step actually cancelled, the pool must still hand back a
		// clean parser: a clean Parse of the small baseline file on the SAME Session must match
		// the fixed expected answer exactly. A mismatch here means a resumed parse silently
		// returned the wrong (large file's, or a prior parse's) tree.
		result, err := s.Parse(context.Background(), smallPath, small, Go)
		if err != nil {
			t.Fatalf("step %d/%d (timeout=%v): clean Parse of baseline file failed: %v", i, steps, timeout, err)
		}
		if result.HasError {
			t.Fatalf("step %d/%d (timeout=%v): baseline parse has ERROR nodes — possible resumed-parse corruption", i, steps, timeout)
		}
		if len(result.Symbols) != expectedSymbols || result.LineCount != expectedLines {
			t.Fatalf("step %d/%d (timeout=%v): baseline parse mismatch — got %d symbols/%d lines, want %d/%d — possible resumed-parse corruption",
				i, steps, timeout, len(result.Symbols), result.LineCount, expectedSymbols, expectedLines)
		}
	}

	if cancelled == 0 {
		t.Fatal("zero of the sweep steps actually triggered a cancellation — test is not exercising the cancel-mid-parse path")
	}
	t.Logf("%d/%d sweep steps actually cancelled", cancelled, steps)
}
