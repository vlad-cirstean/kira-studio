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
// recycles parsers across callers exactly as codeindex's sync workers do. Before the
// ParseWithOptions fix, go-tree-sitter's deprecated ParseCtx spawned a goroutine that wrote to a
// NULL CancellationFlag on cancellation — a guaranteed, uncatchable SIGSEGV that killed the whole
// process (reproduced by the review round roughly 30-40% of the time under -count=15). There is
// nothing to assert beyond "the test binary survives": a crash here means the process is gone,
// not a failed assertion. Run with -race and a high -count (per CLAUDE.md's own instructions for
// this package) for real confidence.
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
