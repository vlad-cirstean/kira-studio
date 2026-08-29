package preconnect

import "strings"

// stderrTailMax mirrors preconnect.ts's STDERR_TAIL_MAX.
const stderrTailMax = 200

// tailTracker is a literal port of preconnect.ts's makeTailTracker (`:59-75`). Chunks from a pipe
// never line up with newlines — a single line can arrive split across several reads, or several
// lines can arrive in one. carry holds only the unterminated remainder after the last newline
// seen so far; without tracking that separately from last, a line already completed by a
// previous chunk's trailing newline would get silently reused as a prefix for the next chunk's
// content instead of being replaced by it. The zero value is ready to use.
type tailTracker struct {
	carry string
	last  string
}

func (t *tailTracker) push(chunk string) {
	lines := splitLines(t.carry + chunk)
	t.carry = lines[len(lines)-1]
	for _, line := range lines[:len(lines)-1] {
		if strings.TrimSpace(line) != "" {
			t.last = line
		}
	}
	if strings.TrimSpace(t.carry) != "" {
		t.last = t.carry
	}
}

func (t *tailTracker) value() string {
	if len(t.last) > stderrTailMax {
		return t.last[:stderrTailMax]
	}
	return t.last
}

// splitLines mirrors JS's `.split(/\r?\n/)`.
func splitLines(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
}
