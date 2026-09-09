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
}

func newOutputCollector(onBatch func([]Line)) *outputCollector {
	return &outputCollector{
		onBatch:   onBatch,
		now:       time.Now,
		streamBuf: map[string][]byte{"stdout": nil, "stderr": nil},
	}
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
	c.streamBuf[stream] = buf
	batch := c.takeBatchIfDueLocked(false)
	c.mu.Unlock()
	c.deliver(batch)
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
	c.mu.Unlock()
	c.deliver(batch)
}

// tick is the idle-flush path: called periodically while the process runs so a small pending batch
// that never hits either cap is still delivered within roughly batchInterval, even during a lull
// with no new output at all (D12's own 100ms cadence, not merely "100ms minimum spacing").
func (c *outputCollector) tick() {
	c.mu.Lock()
	batch := c.takeBatchIfDueLocked(false)
	c.mu.Unlock()
	c.deliver(batch)
}

func (c *outputCollector) deliver(batch []Line) {
	if len(batch) > 0 && c.onBatch != nil {
		c.onBatch(batch)
	}
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
