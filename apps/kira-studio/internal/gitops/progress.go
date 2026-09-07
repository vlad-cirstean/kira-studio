package gitops

import (
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Progress is one decoded progress line — @kira/git-ipc's own RemoteProgress minus repoId (D15).
type Progress struct {
	Phase   string
	Percent *int
	Done    *int
	Total   *int
	Remote  bool
}

// percentLine matches "<phase>: NN% (n/N)"; doneLine matches "<phase>: N, done.".
var (
	percentLine = regexp.MustCompile(`^(.+?):\s+(\d+)% \((\d+)/(\d+)\)`)
	doneLine    = regexp.MustCompile(`^(.+?):\s+(\d+), done\.$`)
)

// ProgressParser is a pure incremental decoder over git's own stderr progress stream (D15), ported
// from upstream's progress.ts. Write may be called with arbitrarily chunked bytes — a chunk
// boundary can fall mid-percentage (probe P9) — and splits on BOTH '\r' (an update within one
// phase) and '\n' (a phase's own final line).
type ProgressParser struct {
	emit func(Progress)
	buf  []byte
}

// NewProgressParser constructs a parser that calls emit for every recognised line. Nothing is
// buffered across Write calls except a genuinely incomplete trailing line.
func NewProgressParser(emit func(Progress)) *ProgressParser {
	return &ProgressParser{emit: emit}
}

// Write feeds chunk into the decoder. Every complete '\r'- or '\n'-terminated line is processed
// immediately; an unmatched line is dropped from progress (it still reaches the caller's own
// stderr buffer untouched, gitclient.Spec.OnStderr's whole point) — not an error, and not treated
// as a stall: a transcript with no progress lines at all calls emit zero times.
func (p *ProgressParser) Write(chunk []byte) {
	p.buf = append(p.buf, chunk...)
	for {
		idx := -1
		for i, b := range p.buf {
			if b == '\r' || b == '\n' {
				idx = i
				break
			}
		}
		if idx < 0 {
			return
		}
		line := string(p.buf[:idx])
		p.buf = p.buf[idx+1:]
		p.processLine(line)
	}
}

func (p *ProgressParser) processLine(line string) {
	remote := false
	if rest, ok := strings.CutPrefix(line, "remote: "); ok {
		remote = true
		line = rest
	}
	// git pads "remote: " lines out to a fixed column (probe P7/P9) — trimmed unconditionally,
	// harmless for a line that was never padded.
	line = strings.TrimRight(line, " ")
	if line == "" {
		return
	}

	if m := percentLine.FindStringSubmatch(line); m != nil {
		percent := atoiPtr(m[2])
		done := atoiPtr(m[3])
		total := atoiPtr(m[4])
		p.emit(Progress{Phase: m[1], Percent: percent, Done: done, Total: total, Remote: remote})
		return
	}
	if m := doneLine.FindStringSubmatch(line); m != nil {
		done := atoiPtr(m[2])
		p.emit(Progress{Phase: m[1], Done: done, Remote: remote})
		return
	}
	// Unrecognised — dropped from progress, deliberately.
}

func atoiPtr(s string) *int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return nil
	}
	return &n
}

// Throttle wraps emit so a percentage update fires at most once per every, per call site — a real
// transfer can produce dozens of CR-separated percentage updates a second (probe P9), and
// building/encoding/writing every one of them across the wire would be pure waste. D15's own
// guarantee ("the final state of a phase is always emitted") is met without a trailing-edge timer:
// a percentage-less update (Percent == nil, e.g. "Enumerating objects: N, done.") and a 100%
// update (which is always a phase's own last one — probe P9's own "…, done." lines report 100%
// the one time they appear) both pass straight through unconditionally; only a percentage strictly
// below 100 is ever coalesced. now is injected so this is testable without sleeping.
func Throttle(emit func(Progress), every time.Duration, now func() time.Time) func(Progress) {
	var mu sync.Mutex
	var last time.Time
	return func(p Progress) {
		if p.Percent == nil || *p.Percent >= 100 {
			emit(p)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		n := now()
		if last.IsZero() || n.Sub(last) >= every {
			last = n
			emit(p)
		}
	}
}
