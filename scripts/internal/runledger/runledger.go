// Package runledger holds the spend ledger shared by the token-spending script tools.
package runledger

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
)

// FailCharge is the charge assumed for a failed call that reports no spend.
const FailCharge = 0.25

// SpendLine is one call attempt in spend.jsonl. Slug names the unit.
type SpendLine struct {
	Slug    string  `json:"slug"`
	Try     int     `json:"try"`
	OK      bool    `json:"ok"`
	CostUSD float64 `json:"costUsd"`
	Charged float64 `json:"charged"`
	WallMs  int64   `json:"wallMs"`
}

// AppendLine appends v as one JSON line to path.
func AppendLine(path string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(raw, '\n'))
	return err
}

// TotalCharged sums spend.jsonl under dir.
func TotalCharged(dir string) float64 {
	f, err := os.Open(filepath.Join(dir, "spend.jsonl"))
	if err != nil {
		return 0
	}
	defer f.Close()
	var sum float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var s SpendLine
		if json.Unmarshal(sc.Bytes(), &s) == nil {
			sum += s.Charged
		}
	}
	return sum
}

var (
	refusalRe   = regexp.MustCompile(`the limit is|splits into|too many facts|spend cap|invalid`)
	capSpentRe  = regexp.MustCompile(`([0-9.]+) USD spent`)
	rateLimitRe = regexp.MustCompile(`(?i)rate.?limit|usage limit|session limit|hit your .* limit|\b429\b|overloaded|too many requests|limit reached`)
)

func IsRateLimit(err error) bool { return rateLimitRe.MatchString(err.Error()) }

func IsRefusal(err error) bool { return refusalRe.MatchString(err.Error()) }

// FailedCharge is the spend a failed call reports, or FailCharge.
func FailedCharge(err error) float64 {
	if m := capSpentRe.FindStringSubmatch(err.Error()); m != nil {
		if v, e := strconv.ParseFloat(m[1], 64); e == nil {
			return v
		}
	}
	return FailCharge
}

// Ledger tracks charged and in-flight spend against a cap.
type Ledger struct {
	mu       sync.Mutex
	spent    float64
	inflight float64
	stopped  bool
	maxUSD   float64
	path     string
}

// New loads the charged total from dir/spend.jsonl.
func New(dir string, maxUSD float64) *Ledger {
	return &Ledger{maxUSD: maxUSD, path: filepath.Join(dir, "spend.jsonl"), spent: TotalCharged(dir)}
}

// Reserve holds est against the cap; false means the cap is reached and the ledger stays stopped.
func (l *Ledger) Reserve(est float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.stopped || (l.maxUSD > 0 && l.spent+l.inflight+est > l.maxUSD) {
		l.stopped = true
		return false
	}
	l.inflight += est
	return true
}

// Settle releases the reservation and books s.
func (l *Ledger) Settle(est float64, s SpendLine) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.inflight -= est
	l.spent += s.Charged
	_ = AppendLine(l.path, s)
}

// Book charges s without releasing a reservation (a failed attempt before the final try).
func (l *Ledger) Book(s SpendLine) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.spent += s.Charged
	_ = AppendLine(l.path, s)
}

// Note logs s without charging it (a rate-limited attempt).
func (l *Ledger) Note(s SpendLine) {
	l.mu.Lock()
	defer l.mu.Unlock()
	_ = AppendLine(l.path, s)
}

// Stopped reports whether a Reserve was refused.
func (l *Ledger) Stopped() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.stopped
}

// Total is the charged spend so far.
func (l *Ledger) Total() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.spent
}
