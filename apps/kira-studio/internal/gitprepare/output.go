package gitprepare

import (
	"bytes"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// maxRetainedOutput/maxRetainedLines are D12's own caps on the FINAL result's own retained
// transcript (Result.Output) — independent of the streaming batch caps below, enforced by total
// bytes AND total line count, whichever is hit first. Once either cap is hit, every further line is
// still delivered to a live streaming subscriber (below) but is no longer added to the retained
// transcript — Result.Truncated says so rather than silently dropping the fact.
const (
	maxRetainedOutput = 256 << 10
	maxRetainedLines  = 500
)

// maxBatchBytes/maxBatchLines/batchInterval are D12's own streaming cadence: a batch is delivered
// to the caller's OnBatch as soon as either cap is reached, or after batchInterval has elapsed
// since the last delivery, whichever comes first — the same "coalesce, but never withhold past a
// bound" shape gitops.Throttle already uses for remote progress, reimplemented here with stdlib
// only (D18: this package imports nothing else).
const (
	maxBatchBytes = 8 << 10
	maxBatchLines = 64
	batchInterval = 100 * time.Millisecond
)

// maxUnterminatedBuf bounds how many bytes of a stream's not-yet-'\n'-terminated tail write will
// accumulate before giving up on waiting for the newline and flushing what it has as a line of its
// own. G31 round-2 architecture/security review, finding #8: maxRetainedOutput/maxBatchBytes above
// only bound the OUTPUT of this buffer — lines already split on '\n' — never this buffer's own
// unsplit input. A still-running process that simply never emits a '\n' (a runaway loop echoing a
// huge binary blob, or an ordinary script bug) would otherwise grow streamBuf[stream] for the
// entire 15-minute spawn timeout with neither cap able to help at all, since neither one has
// anything to act on until a newline finally shows up.
const maxUnterminatedBuf = 1 << 20

// Line is one sanitized, already-newline-split output line, tagged by which stream it came from.
type Line struct {
	Stream string // "stdout" | "stderr"
	Text   string
}

// sanitizeLine is D12's own output sanitizer, applied to one already-newline-split line (never
// applied across a line boundary, so a multi-byte UTF-8 sequence or an ANSI escape sequence split
// across two Write calls is always whole by the time this runs, since the caller only calls this
// once a full '\n'-terminated line — or the final unterminated remainder at EOF — has been
// assembled): ANSI CSI/OSC sequences are stripped first (pure ASCII, so stripping them first can
// neither create nor destroy a multi-byte UTF-8 sequence elsewhere in the line), then invalid UTF-8
// is replaced with U+FFFD, and every C0 control byte other than tab (plus DEL) is dropped.
func sanitizeLine(raw string) string {
	stripped := stripANSI(raw)

	var b strings.Builder
	b.Grow(len(stripped))
	for i := 0; i < len(stripped); {
		r, size := utf8.DecodeRuneInString(stripped[i:])
		if r == utf8.RuneError && size <= 1 {
			b.WriteRune(utf8.RuneError)
			i++
			continue
		}
		if (r < 0x20 && r != '\t') || r == 0x7f {
			i += size
			continue
		}
		b.WriteRune(r)
		i += size
	}
	return b.String()
}

// stripANSI removes every ANSI CSI ("\x1b[" ... a final byte in 0x40-0x7E) and OSC ("\x1b]" ...
// terminated by BEL or "\x1b\\") sequence from s. An unterminated sequence at the end of s (the
// process was killed mid-escape-sequence) is dropped entirely rather than left dangling.
func stripANSI(s string) string {
	if !strings.ContainsRune(s, 0x1b) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		if s[i] == 0x1b && i+1 < len(s) && (s[i+1] == '[' || s[i+1] == ']') {
			if s[i+1] == '[' {
				j := i + 2
				for j < len(s) && !(s[j] >= 0x40 && s[j] <= 0x7e) {
					j++
				}
				if j >= len(s) {
					break // unterminated — drop the rest.
				}
				i = j + 1
				continue
			}
			// OSC.
			j := i + 2
			terminated := false
			for j < len(s) {
				if s[j] == 0x07 {
					j++
					terminated = true
					break
				}
				if s[j] == 0x1b && j+1 < len(s) && s[j+1] == '\\' {
					j += 2
					terminated = true
					break
				}
				j++
			}
			if !terminated {
				break // unterminated — drop the rest.
			}
			i = j
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// outputCollector accumulates a running process's stdout/stderr into a bounded, sanitized final
// transcript while also delivering throttled, capped streaming batches to onBatch — D12's own two
// output disciplines, one collector, so a line is sanitized exactly once regardless of which of the
// two consumers reads it. Safe for concurrent Write calls from independent stdout/stderr pipes
// (os/exec copies each into its assigned io.Writer from its own goroutine).
//
// write/flush/tick all release mu before calling onBatch (deliver must never run while mu is held,
// since a real onBatch — gitsession's own conn.Emit — can take a while and must not block a
// concurrent stdout/stderr write from making progress). That gap between "batch formed, mu
// released" and "onBatch actually called" is exactly where two batches, formed back-to-back under
// mu (batch A strictly before batch B, since mu itself serializes their formation), could still
// have their onBatch calls interleave in the OPPOSITE order if goroutine scheduling let caller B
// reach onBatch first — G31 round-2 architecture/security review, finding #9. onBatch's own
// contract is an ordered stream of lines; a caller has no way to detect or recover from batch B's
// lines arriving before batch A's.
//
// reserveDelivery/finishDelivery close that gap with a ticket, not a hand-off lock: reserveDelivery
// hands out the next sequence number while mu is STILL held — an O(1), never-blocks-on-I/O
// operation, so it can never make mu itself wait on a slow onBatch call the way locking a
// deliver-order mutex right there would (that was this fix's own first, wrong attempt: it let a
// batch's delivery-order lock stay held across the actual onBatch call, so a later caller's
// reserveDelivery — called while THAT caller's own mu critical section was still open — blocked
// waiting for it, holding mu hostage for everyone). finishDelivery, called only after mu has been
// released, waits on deliverCond for its own ticket's turn, calls onBatch, then advances the turn
// and wakes whichever ticket is next — serializing deliveries into formation order without ever
// coupling mu's own hold time to onBatch's.
type outputCollector struct {
	onBatch func([]Line)
	now     func() time.Time

	mu           sync.Mutex
	streamBuf    map[string][]byte
	final        []Line
	finalBytes   int
	truncated    bool
	pending      []Line
	pendingBytes int
	lastFlush    time.Time

	deliverMu    sync.Mutex
	deliverCond  *sync.Cond
	nextTicket   uint64
	deliveredSeq uint64
}

func newOutputCollector(onBatch func([]Line)) *outputCollector {
	c := &outputCollector{
		onBatch:   onBatch,
		now:       time.Now,
		streamBuf: map[string][]byte{"stdout": nil, "stderr": nil},
	}
	c.deliverCond = sync.NewCond(&c.deliverMu)
	return c
}

// streamWriter adapts one named stream onto io.Writer for cmd.Stdout/cmd.Stderr.
type streamWriter struct {
	c      *outputCollector
	stream string
}

func (w *streamWriter) Write(p []byte) (int, error) {
	w.c.write(w.stream, p)
	return len(p), nil
}

func (c *outputCollector) stdoutWriter() *streamWriter { return &streamWriter{c: c, stream: "stdout"} }
func (c *outputCollector) stderrWriter() *streamWriter { return &streamWriter{c: c, stream: "stderr"} }

func (c *outputCollector) write(stream string, chunk []byte) {
	c.mu.Lock()
	buf := append(c.streamBuf[stream], chunk...)
	for {
		idx := bytes.IndexByte(buf, '\n')
		if idx < 0 {
			break
		}
		c.addLineLocked(stream, sanitizeLine(string(buf[:idx])))
		buf = buf[idx+1:]
	}
	for len(buf) > maxUnterminatedBuf {
		c.addLineLocked(stream, sanitizeLine(string(buf[:maxUnterminatedBuf])))
		buf = buf[maxUnterminatedBuf:]
	}
	c.streamBuf[stream] = buf
	batch := c.takeBatchIfDueLocked(false)
	ticket, reserved := c.reserveDelivery(batch)
	c.mu.Unlock()
	c.finishDelivery(batch, ticket, reserved)
}

// flush is called exactly once, after the process has exited: any unterminated trailing bytes on
// either stream (a script whose very last line has no trailing newline) are still emitted as a
// final line, and any batch still pending is delivered unconditionally.
func (c *outputCollector) flush() {
	c.mu.Lock()
	for _, stream := range []string{"stdout", "stderr"} {
		if rest := c.streamBuf[stream]; len(rest) > 0 {
			c.addLineLocked(stream, sanitizeLine(string(rest)))
			c.streamBuf[stream] = nil
		}
	}
	batch := c.takeBatchIfDueLocked(true)
	ticket, reserved := c.reserveDelivery(batch)
	c.mu.Unlock()
	c.finishDelivery(batch, ticket, reserved)
}

// tick is the idle-flush path: called periodically while the process runs so a small pending batch
// that never hits either cap is still delivered within roughly batchInterval, even during a lull
// with no new output at all (D12's own 100ms cadence, not merely "100ms minimum spacing").
func (c *outputCollector) tick() {
	c.mu.Lock()
	batch := c.takeBatchIfDueLocked(false)
	ticket, reserved := c.reserveDelivery(batch)
	c.mu.Unlock()
	c.finishDelivery(batch, ticket, reserved)
}

// reserveDelivery must be called while mu is STILL held, immediately before it is released: when
// batch is non-empty it hands out the next delivery ticket, a plain counter increment under
// deliverMu — never blocked on I/O, so it can never make mu itself wait on some earlier batch's
// still-in-flight onBatch call. A batch's relative delivery order is thereby fixed at the exact
// point in mu's own critical-section ordering that it was formed.
func (c *outputCollector) reserveDelivery(batch []Line) (ticket uint64, reserved bool) {
	if len(batch) == 0 {
		return 0, false
	}
	c.deliverMu.Lock()
	ticket = c.nextTicket
	c.nextTicket++
	c.deliverMu.Unlock()
	return ticket, true
}

// finishDelivery must be called after mu has been released, with the ticket/reserved values
// reserveDelivery returned from that same critical section. It waits for every earlier ticket to
// finish its own onBatch call first, then calls onBatch, then hands the turn to the next ticket —
// serializing deliveries into formation order without ever holding mu (or blocking any other
// ticket's reserveDelivery) while onBatch runs.
func (c *outputCollector) finishDelivery(batch []Line, ticket uint64, reserved bool) {
	if !reserved {
		return
	}
	c.deliverMu.Lock()
	for c.deliveredSeq != ticket {
		c.deliverCond.Wait()
	}
	c.deliverMu.Unlock()

	if c.onBatch != nil {
		c.onBatch(batch)
	}

	c.deliverMu.Lock()
	c.deliveredSeq++
	c.deliverCond.Broadcast()
	c.deliverMu.Unlock()
}

func (c *outputCollector) addLineLocked(stream, text string) {
	if len(c.final) < maxRetainedLines && c.finalBytes+len(text) <= maxRetainedOutput {
		c.final = append(c.final, Line{Stream: stream, Text: text})
		c.finalBytes += len(text)
	} else {
		c.truncated = true
	}
	c.pending = append(c.pending, Line{Stream: stream, Text: text})
	c.pendingBytes += len(text)
}

func (c *outputCollector) takeBatchIfDueLocked(force bool) []Line {
	if len(c.pending) == 0 {
		return nil
	}
	due := force || len(c.pending) >= maxBatchLines || c.pendingBytes >= maxBatchBytes ||
		c.lastFlush.IsZero() || c.now().Sub(c.lastFlush) >= batchInterval
	if !due {
		return nil
	}
	batch := c.pending
	c.pending = nil
	c.pendingBytes = 0
	c.lastFlush = c.now()
	return batch
}

func (c *outputCollector) finalLines() []Line {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]Line, len(c.final))
	copy(out, c.final)
	return out
}

func (c *outputCollector) isTruncated() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.truncated
}
