// Package termtext strips terminal escapes from process output and keeps its tail.
package termtext

import (
	"bytes"
	"strings"
	"sync"
	"unicode/utf8"
)

// SanitizeLine is the output sanitizer, applied to one already-newline-split line (never
// applied across a line boundary, so a multi-byte UTF-8 sequence or an ANSI escape sequence split
// across two Write calls is always whole by the time this runs, since the caller only calls this
// once a full '\n'-terminated line — or the final unterminated remainder at EOF — has been
// assembled): ANSI CSI/OSC sequences are stripped first (pure ASCII, so stripping them first can
// neither create nor destroy a multi-byte UTF-8 sequence elsewhere in the line), then invalid UTF-8
// is replaced with U+FFFD, and every C0 control byte other than tab (plus DEL) is dropped.
func SanitizeLine(raw string) string {
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
			var next int
			if s[i+1] == '[' {
				next = consumeCSI(s, i)
			} else {
				next = consumeOSC(s, i)
			}
			if next < 0 {
				break // unterminated — drop the rest.
			}
			i = next
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// consumeCSI returns the index just past one ANSI CSI sequence ("\x1b[" ... a final byte in
// 0x40-0x7e) starting at s[i], or -1 if it runs off the end of s unterminated.
func consumeCSI(s string, i int) int {
	j := i + 2
	for j < len(s) && !(s[j] >= 0x40 && s[j] <= 0x7e) {
		j++
	}
	if j >= len(s) {
		return -1
	}
	return j + 1
}

// consumeOSC returns the index just past one ANSI OSC sequence ("\x1b]" ... terminated by BEL or
// "\x1b\\") starting at s[i], or -1 if it runs off the end of s unterminated.
func consumeOSC(s string, i int) int {
	j := i + 2
	for j < len(s) {
		if s[j] == 0x07 {
			return j + 1
		}
		if s[j] == 0x1b && j+1 < len(s) && s[j+1] == '\\' {
			return j + 2
		}
		j++
	}
	return -1
}

// Tail keeps the last maxBytes of raw process output and renders its final lines.
// Safe for concurrent use.
type Tail struct {
	mu      sync.Mutex
	max     int
	buf     []byte
	wrapped bool
}

// NewTail returns a Tail that retains at most maxBytes.
func NewTail(maxBytes int) *Tail { return &Tail{max: maxBytes} }

// Write appends b, dropping the oldest bytes past the cap. It never fails.
func (t *Tail) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, b...)
	if over := len(t.buf) - t.max; over > 0 {
		t.buf = append(t.buf[:0], t.buf[over:]...)
		t.wrapped = true
	}
	return len(b), nil
}

// Lines returns the last n non-empty sanitized lines joined by newline. A trailing "\r" is
// ignored and a "\r" inside a line keeps only the text after it (progress redraws). Once the ring
// has dropped bytes, the first line is partial and is omitted.
func (t *Tail) Lines(n int) string {
	t.mu.Lock()
	raw := append([]byte(nil), t.buf...)
	wrapped := t.wrapped
	t.mu.Unlock()

	parts := bytes.Split(raw, []byte{'\n'})
	if wrapped && len(parts) > 1 {
		parts = parts[1:]
	}
	var out []string
	for i := len(parts) - 1; i >= 0 && len(out) < n; i-- {
		p := bytes.TrimRight(parts[i], "\r")
		if j := bytes.LastIndexByte(p, '\r'); j >= 0 {
			p = p[j+1:]
		}
		line := strings.TrimSpace(SanitizeLine(string(p)))
		if line == "" {
			continue
		}
		out = append(out, line)
	}
	for l, r := 0, len(out)-1; l < r; l, r = l+1, r-1 {
		out[l], out[r] = out[r], out[l]
	}
	return strings.Join(out, "\n")
}
