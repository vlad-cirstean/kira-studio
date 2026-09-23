package porcelain

import (
	"bytes"
	"errors"
)

// fieldDelim is `%x1f` (unit separator) — the delimiter every log/for-each-ref format string in
// this package uses between fields within one record. The record delimiter itself is always NUL
// (git's own `-z`), never this byte, which is what lets the final field safely contain a literal
// 0x1f (a pathological commit subject) without corrupting the split (SplitLimitedFields, below).
//
// LogFormat/ScanFormat and RefsFormat/TagRefsFormat do NOT use fieldDelim any more (F3): a
// hostile author/committer/tagger name or email CAN carry a literal 0x1f (verified with
// GIT_AUTHOR_NAME=$'Mal\x1fory'), which would silently shift every field after it when that field
// is not last. Those formats are NUL-delimited instead (FieldGrouper/splitOneNULRecord, below) —
// NUL is the one byte git guarantees can never appear inside any of its own field values. fieldDelim
// stays 0x1f only where the hostile field is provably already last (StashFormat's own %gs,
// bodyAndSignatureFormat's own %b) — SplitLimitedFields' absorb-the-last-field behavior is exactly
// what makes 0x1f safe there.
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
//
// A NUL-delimited caller (LogFormat/ScanFormat, F3) uses this same type to split a flat FIELD
// stream, not a record stream — see FieldGrouper's own doc comment for why.
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

// FieldGrouper batches a flat NUL-delimited field stream into fixed-size records (F3): git
// cannot put a literal NUL inside any field value (the one structural guarantee it makes about
// its own metadata), which is what makes NUL the only field delimiter that is safe even in a
// non-last position — unlike 0x1f, which a hostile author/committer/tagger name or email can
// carry. But once every field (LogFormat/ScanFormat's own %x00) AND the record terminator (`-z`'s
// own automatic per-commit NUL) are the identical byte, a record boundary is no longer a
// distinguishable delimiter occurrence — it is purely "every fieldCount-th token" of a
// RecordSplitter(0) fed the same stream. FieldGrouper carries a partial group of fields across
// Push calls exactly like RecordSplitter carries a partial record.
type FieldGrouper struct {
	fieldCount int
	pending    [][]byte
}

// NewFieldGrouper constructs a grouper over fieldCount — LogFormat/ScanFormat's own FieldCount/
// ScanFieldCount for every caller in this package today.
func NewFieldGrouper(fieldCount int) *FieldGrouper {
	return &FieldGrouper{fieldCount: fieldCount}
}

// Push appends newFields (as a RecordSplitter(0) Push over the same underlying NUL-delimited
// stream returns them — each token IS one field here, not one whole record) and returns every
// complete fieldCount-sized group now available, oldest first.
func (g *FieldGrouper) Push(newFields [][]byte) [][][]byte {
	g.pending = append(g.pending, newFields...)
	var groups [][][]byte
	for len(g.pending) >= g.fieldCount {
		group := make([][]byte, g.fieldCount)
		copy(group, g.pending[:g.fieldCount])
		groups = append(groups, group)
		g.pending = g.pending[g.fieldCount:]
	}
	return groups
}

// Flush returns whatever fields remain ungrouped, clearing the grouper's own buffer — non-empty
// only on a genuine protocol violation (a stream that ended mid-record).
func (g *FieldGrouper) Flush() [][]byte {
	if len(g.pending) == 0 {
		return nil
	}
	rest := g.pending
	g.pending = nil
	return rest
}

// splitOneNULRecord splits raw — exactly one NUL-fielded record (F3's LogFormat/ScanFormat
// framing, where field and record delimiters are the identical byte) — into fieldCount fields.
// raw must end with the record's own trailing NUL (git's `-z` own per-record terminator, which
// lands right after the last field since the format string carries no separate delimiter after
// it — probed against real git 2.43.0). Used by one-shot, whole-buffer callers (a single `show -s
// -z` spawn); a streaming caller uses RecordSplitter+FieldGrouper instead.
func splitOneNULRecord(raw []byte, fieldCount int) ([][]byte, error) {
	if len(raw) == 0 || raw[len(raw)-1] != 0 {
		return nil, errors.New("porcelain: NUL-fielded record missing its trailing NUL terminator")
	}
	fields := bytes.Split(raw[:len(raw)-1], []byte{0})
	if len(fields) != fieldCount {
		return nil, errors.New("porcelain: NUL-fielded record has the wrong field count")
	}
	return fields, nil
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
