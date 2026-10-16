// Package linewriter splits a byte stream into lines.
package linewriter

import (
	"bytes"
	"sync"
)

// MaxLine caps one line; stream-json lines get large (tool results, thinking).
const MaxLine = 16 << 20

// Writer splits a byte stream into lines; a line over MaxLine is cut and marked.
type Writer struct {
	mu      sync.Mutex
	buf     []byte
	dropped bool
	onLine  func(string)
}

// New returns a Writer calling onLine for each complete line, outside its lock.
func New(onLine func(string)) *Writer { return &Writer{onLine: onLine} }

// Write implements io.Writer.
func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	var lines []string
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			w.accumulate(rest)
			break
		}
		w.accumulate(rest[:i])
		lines = append(lines, w.take())
		rest = rest[i+1:]
	}
	w.mu.Unlock()
	for _, l := range lines {
		w.onLine(l)
	}
	return len(p), nil
}

func (w *Writer) accumulate(b []byte) {
	if w.dropped {
		return
	}
	if len(w.buf)+len(b) > MaxLine {
		w.buf = append(w.buf, b[:MaxLine-len(w.buf)]...)
		w.dropped = true
		return
	}
	w.buf = append(w.buf, b...)
}

func (w *Writer) take() string {
	s := string(w.buf)
	if w.dropped {
		s += "…"
	}
	w.buf, w.dropped = w.buf[:0], false
	return s
}

// Flush emits a trailing line with no newline.
func (w *Writer) Flush() {
	w.mu.Lock()
	var line string
	has := len(w.buf) > 0
	if has {
		line = w.take()
	}
	w.mu.Unlock()
	if has {
		w.onLine(line)
	}
}
