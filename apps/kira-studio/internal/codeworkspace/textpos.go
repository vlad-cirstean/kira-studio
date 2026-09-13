package codeworkspace

import "unicode/utf8"

// LineIndex converts between Monaco's own 1-based line / 1-based UTF-16-column positions and the
// 0-based row / byte-column positions codegraph and codeindex speak (C6 §4/D1). codegraph reads
// file bytes never, so this is the one place in the app that can honestly do this conversion —
// codeworkspace already reads the same bytes for ReadFile.
//
// Five rules, checked against a fixture in textpos_test.go:
//
//  1. Lines split on '\n' only. A '\r' before a '\n' stays part of the preceding line's bytes
//     (matching tree-sitter's own row/column counting), and both directions clamp at the line's
//     last non-EOL byte since Monaco's line content excludes the EOL entirely.
//  2. One UTF-16 unit per rune <= U+FFFF, two per rune above it (a surrogate pair). A column
//     landing between the two halves of a pair (only reachable from a malformed client position)
//     clamps to the pair's first byte, never its second (not a rune boundary at all).
//  3. An invalid UTF-8 byte is exactly one UTF-16 unit — not a guess about Monaco, but what the
//     buffer actually contains: ReadFile returns string(data), and encoding/json replaces each
//     invalid byte with one U+FFFD crossing the bridge, so utf8.DecodeRune's RuneError/size==1
//     answer for exactly those bytes needs no special case.
//  4. A tab is one UTF-16 unit, never expanded — Monaco's column is a code-unit index; visible/
//     display columns (tabSize) are a separate concept that never crosses this boundary.
//  5. Clamping, never erroring — line/column/byte offsets out of range clamp into range rather
//     than fail. A position computed against bytes that drifted from what Monaco shows (the
//     watcher hasn't caught up yet) is a stale answer, not a fault.
//
// The honest limit: the bytes converted against are the file on disk *now*. If the worktree file
// changed after the tab opened, positions are computed against the newer bytes while Monaco shows
// the older ones — a hover in that drift window can be off by a line. The watcher keeps the index
// fresh on the same signal, so the two converge.
type LineIndex struct {
	data   []byte
	starts []int
}

// NewLineIndex builds a LineIndex over data. starts[i] is the byte offset of line i (0-based);
// starts[0] is always 0.
func NewLineIndex(data []byte) *LineIndex {
	starts := make([]int, 1, 16)
	starts[0] = 0
	for i, b := range data {
		if b == '\n' {
			starts = append(starts, i+1)
		}
	}
	return &LineIndex{data: data, starts: starts}
}

// LineCount returns how many lines data has — always at least 1, even for an empty file.
func (li *LineIndex) LineCount() int { return len(li.starts) }

// lineBounds returns [start, end) byte offsets for 0-based row, end excluding the row's own
// trailing EOL entirely — both the '\n' and, for a CRLF line, the '\r' immediately before it.
// The '\r' byte still belongs to this row for row-splitting purposes (rule 1: starts[] only ever
// breaks on '\n'), but Monaco's own line content never includes it, so both ByteOffset and
// Position must stop consuming right before it — the "last non-EOL byte" rule 1's own doc comment
// names, on both directions: ByteOffset never advances a column into it, and Position never counts
// it as a further column past the line's own displayed length.
func (li *LineIndex) lineBounds(row int) (start, end int) {
	start = li.starts[row]
	if row+1 < len(li.starts) {
		end = li.starts[row+1] - 1 // exclude the '\n' itself
	} else {
		end = len(li.data)
	}
	if end > start && li.data[end-1] == '\r' {
		end-- // exclude a CRLF line's own '\r' too.
	}
	if end < start {
		end = start
	}
	return start, end
}

// ByteOffset maps Monaco's 1-based line and 1-based UTF-16 column to an absolute byte offset,
// clamping every out-of-range input into range (rule 5) rather than erroring.
func (li *LineIndex) ByteOffset(line, column int) int {
	row := line - 1
	if row < 0 {
		row = 0
	}
	if row >= li.LineCount() {
		row = li.LineCount() - 1
	}
	if column < 1 {
		column = 1
	}
	start, end := li.lineBounds(row)

	units := 1 // Monaco's column is 1-based; units counts code units consumed so far, starting at 1.
	off := start
	for off < end {
		if units >= column {
			return off
		}
		r, size := utf8.DecodeRune(li.data[off:end])
		if r == utf8.RuneError && size <= 1 {
			units++ // rule 3: one invalid byte, one UTF-16 unit.
			off++
			continue
		}
		if r > 0xFFFF {
			units += 2 // rule 2: a surrogate pair.
		} else {
			units++
		}
		if units > column {
			// column asked for a position strictly between this rune's two UTF-16 halves — clamp
			// to the rune's own first byte (rule 2), never mid-rune.
			return off
		}
		off += size
	}
	return end
}

// Position maps codegraph's 0-based row and byte column (a byte offset from the start of the
// row) to Monaco's 1-based line and 1-based UTF-16 column, clamping out-of-range input (rule 5).
func (li *LineIndex) Position(row, byteColumn int) (line, column int) {
	if row < 0 {
		row = 0
	}
	if row >= li.LineCount() {
		row = li.LineCount() - 1
	}
	start, end := li.lineBounds(row)
	if byteColumn < 0 {
		byteColumn = 0
	}
	target := start + byteColumn
	if target > end {
		target = end
	}

	units := 1
	off := start
	for off < target {
		r, size := utf8.DecodeRune(li.data[off:end])
		if r == utf8.RuneError && size <= 1 {
			units++
			off++
			continue
		}
		if r > 0xFFFF {
			units += 2
		} else {
			units++
		}
		off += size
	}
	return row + 1, units
}
