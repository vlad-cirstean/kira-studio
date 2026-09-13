package page

import (
	"unicode/utf8"
)

// columnScratch accumulates one column's rows into growable scratch and only copies into
// exactly-sized buffers at finish() — page.ts's ColumnScratch, field for field. reverse ordering is
// honoured entirely inside finish() by choosing which row order to copy in; every row's byte range
// is already addressable via rowStart, so no extra buffer is needed.
type columnScratch struct {
	buffer        []byte
	used          int
	rowStart      []int
	isNullRow     []bool
	truncatedRows map[int]struct{}
}

func newColumnScratch() *columnScratch {
	return &columnScratch{buffer: make([]byte, 256), rowStart: []int{0}}
}

func (s *columnScratch) grow(extra int) {
	if s.used+extra <= len(s.buffer) {
		return
	}
	size := len(s.buffer) * 2
	for size < s.used+extra {
		size *= 2
	}
	next := make([]byte, size)
	copy(next, s.buffer[:s.used])
	s.buffer = next
}

// truncateUTF8ToBoundary cuts b at maxBytes on a UTF-8 rune boundary, never mid-sequence — a split
// rune would make the renderer's decoder emit U+FFFD and the cell look corrupted. Go's
// utf8.DecodeLastRune finds the boundary directly; the JS port had to walk continuation bytes by
// hand because TextEncoder gives no boundary information.
func truncateUTF8ToBoundary(b []byte, maxBytes int) []byte {
	if len(b) <= maxBytes {
		return b
	}
	cut := b[:maxBytes]
	// If the byte just past the cut is a continuation byte, the cut landed mid-rune; back off to
	// the start of that rune and drop it entirely, matching page.ts's own boundary rule.
	for len(cut) > 0 {
		r, size := utf8.DecodeLastRune(cut)
		if r != utf8.RuneError || size != 1 {
			break
		}
		cut = cut[:len(cut)-1]
	}
	return cut
}

// appendValue appends one row's value (nil for NULL) and reports whether it was truncated.
func (s *columnScratch) appendValue(value *string, row int, maxBytes int) bool {
	if value == nil {
		s.isNullRow = append(s.isNullRow, true)
		s.rowStart = append(s.rowStart, s.used)
		return false
	}
	s.isNullRow = append(s.isNullRow, false)
	b := []byte(*value)
	truncated := false
	if len(b) > maxBytes {
		b = truncateUTF8ToBoundary(b, maxBytes)
		if s.truncatedRows == nil {
			s.truncatedRows = make(map[int]struct{})
		}
		s.truncatedRows[row] = struct{}{}
		truncated = true
	}
	s.grow(len(b))
	copy(s.buffer[s.used:], b)
	s.used += len(b)
	s.rowStart = append(s.rowStart, s.used)
	return truncated
}

func (s *columnScratch) finish(rowCount int, reversed bool) Chunk {
	nulls := make([]byte, bitsetBytes(rowCount))
	offsets := make([]uint32, rowCount+1)
	data := make([]byte, s.used)
	// Explicitly non-nil (make always returns non-nil, even at zero length): the FlatBuffers
	// `truncated` vector is (required) and must always be written, even at length zero — an
	// omitted field decodes as `null` on the TypeScript side, not an empty array (P11 schema note).
	truncated := make([]uint32, 0, len(s.truncatedRows))

	cursor := 0
	for newRow := 0; newRow < rowCount; newRow++ {
		oldRow := newRow
		if reversed {
			oldRow = rowCount - 1 - newRow
		}
		start := s.rowStart[oldRow]
		end := s.rowStart[oldRow+1]
		length := end - start
		if length > 0 {
			copy(data[cursor:], s.buffer[start:end])
		}
		cursor += length
		offsets[newRow+1] = uint32(cursor)
		if s.isNullRow[oldRow] {
			nulls[newRow>>3] |= 1 << (newRow & 7)
		}
		if _, ok := s.truncatedRows[oldRow]; ok {
			truncated = append(truncated, uint32(newRow))
		}
	}
	// truncatedRows iterates the map above in newRow order already (the loop runs newRow
	// ascending), so the result is already sorted — no separate sort needed.
	return Chunk{Data: data, Offsets: offsets, Nulls: nulls, Truncated: truncated}
}
