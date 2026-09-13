package gitprepare

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSanitizeLine_InvalidUTF8ReplacedWithReplacementChar(t *testing.T) {
	raw := "hello \xff\xfe world"
	got := sanitizeLine(raw)
	if !strings.Contains(got, "�") {
		t.Fatalf("got %q, want a replacement char", got)
	}
	if strings.Contains(got, "\xff") || strings.Contains(got, "\xfe") {
		t.Fatalf("got %q, invalid bytes survived", got)
	}
}

func TestSanitizeLine_StripsC0ControlBytesExceptTab(t *testing.T) {
	raw := "a\x01b\x07c\td\x1fe"
	got := sanitizeLine(raw)
	want := "abc\tde"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSanitizeLine_StripsDEL(t *testing.T) {
	got := sanitizeLine("a\x7fb")
	if got != "ab" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_StripsCSI(t *testing.T) {
	raw := "\x1b[31mred\x1b[0m plain"
	got := sanitizeLine(raw)
	if got != "red plain" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_StripsOSC(t *testing.T) {
	// OSC terminated by BEL, and OSC terminated by ESC \.
	raw := "before\x1b]0;window title\x07after\x1b]8;;http://x\x1b\\end"
	got := sanitizeLine(raw)
	if got != "beforeafterend" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_UnterminatedEscapeDropped(t *testing.T) {
	got := sanitizeLine("keep\x1b[31")
	if got != "keep" {
		t.Fatalf("got %q", got)
	}
}

// TestSanitizeLine_PlainTextUnaffected: sanitizeLine is only ever called on one already
// newline-split line (never one still containing an embedded '\n', which the C0-strip rule would
// otherwise remove along with every other control byte) — ordinary printable text passes through
// byte for byte.
func TestSanitizeLine_PlainTextUnaffected(t *testing.T) {
	got := sanitizeLine("installing deps... done (1/1)")
	if got != "installing deps... done (1/1)" {
		t.Fatalf("got %q", got)
	}
}

// TestOutputCollector_LineSplittingAcrossWrites proves a line split across two Write calls (an
// arbitrarily chunked pipe) is reassembled correctly before sanitizing/retaining.
func TestOutputCollector_LineSplittingAcrossWrites(t *testing.T) {
	c := newOutputCollector(nil)
	c.write("stdout", []byte("hel"))
	c.write("stdout", []byte("lo wor"))
	c.write("stdout", []byte("ld\nsecond line\n"))
	lines := c.finalLines()
	if len(lines) != 2 || lines[0].Text != "hello world" || lines[1].Text != "second line" {
		t.Fatalf("got %+v", lines)
	}
}

// TestOutputCollector_TrailingUnterminatedLineFlushed proves flush() surfaces a final line with no
// trailing newline, rather than losing it.
func TestOutputCollector_TrailingUnterminatedLineFlushed(t *testing.T) {
	c := newOutputCollector(nil)
	c.write("stdout", []byte("no newline at all"))
	if lines := c.finalLines(); len(lines) != 0 {
		t.Fatalf("line should not appear before flush: %+v", lines)
	}
	c.flush()
	lines := c.finalLines()
	if len(lines) != 1 || lines[0].Text != "no newline at all" {
		t.Fatalf("got %+v", lines)
	}
}

// TestOutputCollector_UnterminatedStreamBufDoesNotGrowUnbounded is G31 round-2 architecture/
// security review, finding #8: maxRetainedOutput/maxBatchBytes (proved by the two tests below this
// one) only bound already-'\n'-split LINES; streamBuf[stream] itself — the raw, not-yet-terminated
// tail write() accumulates while waiting for the next '\n' — had no bound of its own at all before
// maxUnterminatedBuf. A single write() call carrying many megabytes with no '\n' anywhere in it (a
// runaway process echoing a huge blob, or a script bug) used to grow that buffer by the whole
// chunk's size in one shot, regardless of either cap above. This proves a single such write is
// instead split into maxUnterminatedBuf-sized lines as it goes (each one still passing through the
// exact same sanitize+cap pipeline every other line does — TestOutputCollector_RetainedBytesCapped
// below is what caps its total contribution to the retained transcript), rather than the streaming
// buffer itself absorbing the whole thing in memory unbounded.
func TestOutputCollector_UnterminatedStreamBufDoesNotGrowUnbounded(t *testing.T) {
	c := newOutputCollector(nil)
	huge := strings.Repeat("x", maxUnterminatedBuf*3+1000) // no '\n' anywhere in it.
	c.write("stdout", []byte(huge))

	c.mu.Lock()
	bufLen := len(c.streamBuf["stdout"])
	c.mu.Unlock()
	if bufLen > maxUnterminatedBuf {
		t.Fatalf("streamBuf[stdout] len = %d after one oversized unterminated write, want <= %d (the "+
			"buffer must flush itself as it goes, not absorb the whole chunk)", bufLen, maxUnterminatedBuf)
	}

	// maxUnterminatedBuf (1 MiB) is itself well past maxRetainedOutput (256 KiB), so the very first
	// forced flush already exceeds the retained-transcript budget — Truncated must reflect that,
	// exactly as an equally oversized but '\n'-terminated line already would.
	if !c.isTruncated() {
		t.Fatal("want Truncated true — the forced flush of an oversized unterminated chunk exceeds maxRetainedOutput")
	}

	// The collector must still work normally afterward — a real '\n'-terminated line right after
	// the oversized one is decoded cleanly, proving this isn't a stuck or corrupted state. The
	// leading '\n' terminates whatever unterminated remainder of the oversized write is still
	// buffered (huge's own length need not be an exact multiple of maxUnterminatedBuf), so
	// "ordinary line" itself starts clean.
	c.write("stdout", []byte("\nordinary line\n"))
	c.flush()
	lines := c.finalLines()
	if lines[len(lines)-1].Text != "ordinary line" {
		t.Fatalf("last line = %q, want %q — the collector must recover cleanly after an oversized flush", lines[len(lines)-1].Text, "ordinary line")
	}
}

// TestOutputCollector_RetainedLinesCapped proves maxRetainedLines: more lines than the cap still
// produce exactly the cap's worth of retained lines, with Truncated set.
func TestOutputCollector_RetainedLinesCapped(t *testing.T) {
	c := newOutputCollector(nil)
	var buf strings.Builder
	for i := 0; i < maxRetainedLines+50; i++ {
		buf.WriteString("line\n")
	}
	c.write("stdout", []byte(buf.String()))
	c.flush()
	if got := len(c.finalLines()); got != maxRetainedLines {
		t.Fatalf("got %d retained lines, want %d", got, maxRetainedLines)
	}
	if !c.isTruncated() {
		t.Fatal("want Truncated true")
	}
}

// TestOutputCollector_RetainedBytesCapped proves maxRetainedOutput: a few very long lines exceed
// the byte cap well before the line-count cap, and truncation is still reported.
func TestOutputCollector_RetainedBytesCapped(t *testing.T) {
	c := newOutputCollector(nil)
	long := strings.Repeat("x", 50<<10) // 50 KiB per line.
	var buf strings.Builder
	for i := 0; i < 10; i++ { // 500 KiB total, well past the 256 KiB cap.
		buf.WriteString(long)
		buf.WriteByte('\n')
	}
	c.write("stdout", []byte(buf.String()))
	c.flush()
	lines := c.finalLines()
	totalBytes := 0
	for _, l := range lines {
		totalBytes += len(l.Text)
	}
	if totalBytes > maxRetainedOutput {
		t.Fatalf("retained %d bytes, want <= %d", totalBytes, maxRetainedOutput)
	}
	if !c.isTruncated() {
		t.Fatal("want Truncated true")
	}
}

// TestOutputCollector_NoTruncationUnderCap: a small transcript is retained in full with
// Truncated false.
func TestOutputCollector_NoTruncationUnderCap(t *testing.T) {
	c := newOutputCollector(nil)
	c.write("stdout", []byte("a\nb\nc\n"))
	c.flush()
	if lines := c.finalLines(); len(lines) != 3 {
		t.Fatalf("got %+v", lines)
	}
	if c.isTruncated() {
		t.Fatal("want Truncated false")
	}
}

// TestOutputCollector_BatchCappedByLineCount proves a single write producing more than
// maxBatchLines lines is delivered as a full-size batch (>= maxBatchLines) rather than waiting for
// the throttle interval to dribble the rest out one at a time.
func TestOutputCollector_BatchCappedByLineCount(t *testing.T) {
	var mu sync.Mutex
	var batches [][]Line
	c := newOutputCollector(func(b []Line) {
		mu.Lock()
		defer mu.Unlock()
		batches = append(batches, append([]Line{}, b...))
	})
	var buf strings.Builder
	for i := 0; i < maxBatchLines+10; i++ {
		buf.WriteString("l\n")
	}
	c.write("stdout", []byte(buf.String()))

	mu.Lock()
	defer mu.Unlock()
	if len(batches) == 0 {
		t.Fatal("expected at least one batch to have been delivered immediately")
	}
	if len(batches[0]) < maxBatchLines {
		t.Fatalf("first batch has %d lines, want >= %d (cap-triggered)", len(batches[0]), maxBatchLines)
	}
}

// TestOutputCollector_BatchThrottledByInterval proves two small writes within the throttle window
// are coalesced into one batch (delivered only once the interval or flush triggers it), using an
// injected clock so the test does not sleep.
func TestOutputCollector_BatchThrottledByInterval(t *testing.T) {
	var mu sync.Mutex
	var batches [][]Line
	c := newOutputCollector(func(b []Line) {
		mu.Lock()
		defer mu.Unlock()
		batches = append(batches, append([]Line{}, b...))
	})
	now := time.Unix(0, 0)
	c.now = func() time.Time { return now }

	c.write("stdout", []byte("first\n"))
	mu.Lock()
	gotAfterFirst := len(batches)
	mu.Unlock()
	if gotAfterFirst != 1 {
		t.Fatalf("first write (lastFlush was zero) should deliver immediately, got %d batches", gotAfterFirst)
	}

	now = now.Add(10 * time.Millisecond) // well under batchInterval
	c.write("stdout", []byte("second\n"))
	mu.Lock()
	gotAfterSecond := len(batches)
	mu.Unlock()
	if gotAfterSecond != 1 {
		t.Fatalf("second write within the throttle window must not deliver yet, got %d batches", gotAfterSecond)
	}

	now = now.Add(200 * time.Millisecond) // past batchInterval
	c.tick()
	mu.Lock()
	defer mu.Unlock()
	if len(batches) != 2 {
		t.Fatalf("got %d batches, want 2 (the throttled second one delivered on tick)", len(batches))
	}
	if len(batches[1]) != 1 || batches[1][0].Text != "second" {
		t.Fatalf("second batch = %+v", batches[1])
	}
}

// TestOutputCollector_FlushDeliversPendingUnconditionally: flush() must deliver any still-pending
// batch even when the throttle interval has not elapsed — the process is exiting, nothing later
// will ever flush it.
func TestOutputCollector_FlushDeliversPendingUnconditionally(t *testing.T) {
	var mu sync.Mutex
	var batches [][]Line
	c := newOutputCollector(func(b []Line) {
		mu.Lock()
		defer mu.Unlock()
		batches = append(batches, b)
	})
	now := time.Unix(0, 0)
	c.now = func() time.Time { return now }
	c.write("stdout", []byte("one\n"))
	c.write("stdout", []byte("two\n")) // still within the same instant — throttled.
	c.flush()

	mu.Lock()
	defer mu.Unlock()
	total := 0
	for _, b := range batches {
		total += len(b)
	}
	if total != 2 {
		t.Fatalf("got %d total lines across %d batches, want 2", total, len(batches))
	}
}

// TestOutputCollector_DeliveriesSerializeInFormationOrder is G31 round-2 architecture/security
// review, finding #9: write/flush/tick all form a batch under mu, release mu, and only then call
// onBatch — a gap where two batches formed back-to-back under mu (batch1 strictly before batch2,
// since mu itself serializes formation) could still have their onBatch calls run in the OPPOSITE
// order if goroutine scheduling let the second caller reach deliver() first. onBatch's own contract
// is an ordered stream of lines; a caller (gitsession's own conn.Emit, forwarding worktree.progress
// events) has no way to detect or recover from a later batch's lines arriving before an earlier
// one's.
//
// This exercises reserveDelivery/finishDelivery directly (the exact pair write/flush/tick call)
// rather than racing two goroutines through write() itself, since the whole point is a
// deterministic proof of the serialization guarantee, not a scheduling-dependent flake: batch1 is
// formed and its delivery turn reserved first; its own onBatch call is then held open on a channel
// so the test can prove batch2 — formed and reserved strictly afterward — cannot complete its own
// delivery until batch1's is released.
func TestOutputCollector_DeliveriesSerializeInFormationOrder(t *testing.T) {
	release := make(chan struct{})
	blockedOnFirst := make(chan struct{})
	var mu sync.Mutex
	var order []string
	c := newOutputCollector(func(b []Line) {
		text := b[0].Text
		if text == "first" {
			close(blockedOnFirst)
			<-release
		}
		mu.Lock()
		order = append(order, text)
		mu.Unlock()
	})
	var tick int64
	c.now = func() time.Time {
		tick++
		return time.Unix(0, 0).Add(time.Duration(tick) * time.Second) // always past batchInterval.
	}

	c.mu.Lock()
	c.addLineLocked("stdout", "first")
	batch1 := c.takeBatchIfDueLocked(false)
	ticket1, reserved1 := c.reserveDelivery(batch1)
	c.mu.Unlock()
	if !reserved1 {
		t.Fatal("expected batch1 to reserve a delivery turn")
	}
	go c.finishDelivery(batch1, ticket1, reserved1)
	<-blockedOnFirst // batch1's onBatch has started (and is now blocked) before batch2 is even formed.

	c.mu.Lock()
	c.addLineLocked("stdout", "second")
	batch2 := c.takeBatchIfDueLocked(false)
	ticket2, reserved2 := c.reserveDelivery(batch2)
	c.mu.Unlock()

	done2 := make(chan struct{})
	go func() {
		c.finishDelivery(batch2, ticket2, reserved2)
		close(done2)
	}()

	select {
	case <-done2:
		t.Fatal("batch2's delivery completed before batch1's own delivery was released — deliveries are not serialized in formation order")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	<-done2

	mu.Lock()
	defer mu.Unlock()
	if len(order) != 2 || order[0] != "first" || order[1] != "second" {
		t.Fatalf("delivery order = %v, want [first second]", order)
	}
}
