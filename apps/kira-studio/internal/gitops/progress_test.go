package gitops

import (
	"testing"
	"time"
)

func intPtr(n int) *int { return &n }

func collect(t *testing.T, writes []string) []Progress {
	t.Helper()
	var got []Progress
	p := NewProgressParser(func(pr Progress) { got = append(got, pr) })
	for _, w := range writes {
		p.Write([]byte(w))
	}
	return got
}

func assertProgress(t *testing.T, got, want Progress) {
	t.Helper()
	if got.Phase != want.Phase || got.Remote != want.Remote {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if !intPtrEqual(got.Percent, want.Percent) || !intPtrEqual(got.Done, want.Done) || !intPtrEqual(got.Total, want.Total) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func intPtrEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// TestProgressParser_PushTranscript is probe P9's own push transcript: "Enumerating objects: 1,
// done." (LF-terminated), then "Counting objects: 100% (1/1)" CR-separated from its own final
// ", done." line.
func TestProgressParser_PushTranscript(t *testing.T) {
	got := collect(t, []string{
		"Enumerating objects: 1, done.\n" +
			"Counting objects: 100% (1/1)\rCounting objects: 100% (1/1), done.\n",
	})
	if len(got) != 3 {
		t.Fatalf("got %d events, want 3: %+v", len(got), got)
	}
	assertProgress(t, got[0], Progress{Phase: "Enumerating objects", Done: intPtr(1)})
	assertProgress(t, got[1], Progress{Phase: "Counting objects", Percent: intPtr(100), Done: intPtr(1), Total: intPtr(1)})
	// The CR-separated update and the LF-terminated "…, done." line are numerically identical here
	// (both report 100% (1/1)) — git's own "…, done." suffix is not itself a distinct regex match
	// (percentLine's prefix match wins on both), which is exactly why Throttle treats Percent>=100
	// as its own "never coalesce this" signal rather than relying on a separate done-only shape.
	assertProgress(t, got[2], Progress{Phase: "Counting objects", Percent: intPtr(100), Done: intPtr(1), Total: intPtr(1)})
}

// TestProgressParser_FetchTranscript is probe P9's own fetch transcript: server phases arrive
// "remote: "-prefixed and right-padded with spaces, then the "From …"/ref-update block, which is
// unrecognised and dropped rather than erroring.
func TestProgressParser_FetchTranscript(t *testing.T) {
	got := collect(t, []string{
		"remote: Enumerating objects: 5, done.        \n" +
			"remote: Counting objects:  20% (1/5)\rremote: Counting objects: 100% (5/5), done.        \n" +
			"From ../rem\n" +
			" * branch            main       -> FETCH_HEAD\n",
	})
	if len(got) != 3 {
		t.Fatalf("got %d events, want 3: %+v", len(got), got)
	}
	assertProgress(t, got[0], Progress{Phase: "Enumerating objects", Done: intPtr(5), Remote: true})
	assertProgress(t, got[1], Progress{Phase: "Counting objects", Percent: intPtr(20), Done: intPtr(1), Total: intPtr(5), Remote: true})
	assertProgress(t, got[2], Progress{Phase: "Counting objects", Percent: intPtr(100), Done: intPtr(5), Total: intPtr(5), Remote: true})
}

// TestProgressParser_ChunkSplitMidPercentage proves the parser survives an os/exec pipe boundary
// falling in the middle of a percentage line — a real hazard this decoder exists to handle.
func TestProgressParser_ChunkSplitMidPercentage(t *testing.T) {
	got := collect(t, []string{
		"Receiving objects:  5",
		"0% (5/10)\r",
		"Receiving objects: 100% (10/10), done.\n",
	})
	if len(got) != 2 {
		t.Fatalf("got %d events, want 2: %+v", len(got), got)
	}
	assertProgress(t, got[0], Progress{Phase: "Receiving objects", Percent: intPtr(50), Done: intPtr(5), Total: intPtr(10)})
	assertProgress(t, got[1], Progress{Phase: "Receiving objects", Percent: intPtr(100), Done: intPtr(10), Total: intPtr(10)})
}

func TestProgressParser_UnrecognisedLineIsDroppedNotError(t *testing.T) {
	got := collect(t, []string{"hint: some unrelated hint text\n"})
	if len(got) != 0 {
		t.Fatalf("got %+v, want no events for an unrecognised line", got)
	}
}

func TestProgressParser_NoProgressAtAllEmitsNothing(t *testing.T) {
	got := collect(t, []string{"Everything up-to-date\n"})
	if len(got) != 0 {
		t.Fatalf("got %+v, want no events — no progress is not a stall", got)
	}
}

func TestThrottle_CoalescesPercentageUpdatesButNeverDoneLines(t *testing.T) {
	now := time.Unix(0, 0)
	var got []Progress
	throttled := Throttle(func(p Progress) { got = append(got, p) }, 100*time.Millisecond, func() time.Time { return now })

	throttled(Progress{Phase: "x", Percent: intPtr(10)}) // fires: first call.
	throttled(Progress{Phase: "x", Percent: intPtr(20)}) // suppressed: same instant.
	now = now.Add(50 * time.Millisecond)
	throttled(Progress{Phase: "x", Percent: intPtr(30)})  // still suppressed: under 100ms.
	throttled(Progress{Phase: "x", Percent: intPtr(100)}) // fires regardless: a phase's own last update.
	throttled(Progress{Phase: "x", Done: intPtr(1)})      // a percentage-less update always passes through.

	if len(got) != 3 {
		t.Fatalf("got %d events, want 3: %+v", len(got), got)
	}
	if *got[0].Percent != 10 || *got[1].Percent != 100 || got[2].Done == nil {
		t.Fatalf("got %+v", got)
	}
}
