package porcelain

import (
	"bytes"
	"errors"
)

// fieldDelim is `%x1f` (unit separator) — the delimiter every log/for-each-ref format string in
// this package uses between fields within one record. The record delimiter itself is always NUL
// (git's own `-z`), never this byte, which is what lets the final field safely contain a literal
// 0x1f (a pathological commit subject) without corrupting the split (SplitLimitedFields, below).
const fieldDelim = 0x1f

// maxRemainderBytes bounds how much unterminated data RecordSplitter buffers across Push calls —
// a spawned process that is killed or crashes mid-write must not grow this buffer without limit.
// Comfortably above the largest plausible single record (a subject plus a very long decoration
// list), far below anything that would matter as a memory concern in practice.
const maxRemainderBytes = 64 << 20

// ErrRecordTooLarge is returned by Push when an unterminated record has exceeded
// maxRemainderBytes — a defensive cap, not a limit real git output ever approaches.
var ErrRecordTooLarge = errors.New("porcelain: an unterminated record exceeded the remainder cap")

// RecordSplitter incrementally splits delimiter-terminated output into records, carrying a
// partial record across Push calls — a streaming process's stdout arrives in arbitrarily-sized
// chunks that can split a record (or even a single delimiter byte's neighbourhood) anywhere.
// Every record Push returns is a fresh copy, never a slice into the caller's chunk or this
// splitter's own internal buffer — both may be reused or mutated after Push returns.
type RecordSplitter struct {
	delim     byte
	remainder []byte
}

// NewRecordSplitter constructs a splitter over delim — git's own `-z` NUL (0x00) for every
// caller in this package today.
func NewRecordSplitter(delim byte) *RecordSplitter {
	return &RecordSplitter{delim: delim}
}

// Push appends chunk and returns every complete record that can now be extracted, including ones
// whose start arrived in an earlier Push. A page boundary that stops consuming mid-array must
// still call Push on every subsequent chunk (or Flush at the very end) — the records this call
// does not return are not lost, they stay queued in the splitter's own remainder for the next
// Push to return, never re-derived from a discarded chunk.
func (s *RecordSplitter) Push(chunk []byte) ([][]byte, error) {
	s.remainder = append(s.remainder, chunk...)
	var records [][]byte
	for {
		i := bytes.IndexByte(s.remainder, s.delim)
		if i < 0 {
			break
		}
		rec := make([]byte, i)
		copy(rec, s.remainder[:i])
		records = append(records, rec)
		s.remainder = s.remainder[i+1:]
	}
	if len(s.remainder) > maxRemainderBytes {
		return records, ErrRecordTooLarge
	}
	return records, nil
}

// Flush returns whatever bytes remain un-terminated, clearing the splitter's own buffer. git's
// own `-z` output terminates every record including the last, so a splitter fed a complete,
// uninterrupted stream has nothing left to Flush; a process killed or crashed mid-write can leave
// a genuine partial record, which Flush surfaces rather than silently drops. Returns nil, not an
// empty non-nil slice, when there is nothing pending.
func (s *RecordSplitter) Flush() []byte {
	if len(s.remainder) == 0 {
		return nil
	}
	rest := s.remainder
	s.remainder = nil
	return rest
}

// SplitLimitedFields splits b on delim into exactly n fields when at least n-1 delimiters are
// present — the final field absorbs every remaining byte, delimiters included, so a value in the
// last field position (a commit subject) can safely contain the same byte used to separate the
// earlier fields. Returns fewer than n fields only when b itself contains fewer than n-1
// delimiters (a malformed record); callers check the returned length rather than trust it.
func SplitLimitedFields(b []byte, delim byte, n int) [][]byte {
	if n <= 0 {
		return nil
	}
	fields := make([][]byte, 0, n)
	rest := b
	for len(fields) < n-1 {
		i := bytes.IndexByte(rest, delim)
		if i < 0 {
			break
		}
		fields = append(fields, rest[:i])
		rest = rest[i+1:]
	}
	fields = append(fields, rest)
	return fields
}
