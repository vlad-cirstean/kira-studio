package codeworkspace

import (
	"testing"
	"unicode/utf8"
)

// fixture rows, one per rule in textpos.go's own doc comment:
//
//	row0  "abc"        — plain ASCII (rule 1 baseline).
//	row1  "\tx"        — starts with a tab (rule 4: not expanded, one unit).
//	row2  "hi\r"       — a CRLF line; the '\r' stays part of the line's own bytes (rule 1).
//	row3  "é"          — a 2-byte rune, one UTF-16 unit.
//	row4  "€"          — a 3-byte rune, one UTF-16 unit.
//	row5  "😀"         — a 4-byte rune above U+FFFF, two UTF-16 units (rule 2, a surrogate pair).
//	row6  "\xffz"      — an invalid UTF-8 byte, exactly one UTF-16 unit (rule 3).
//	row7  ""           — the empty last line (the fixture ends with '\n' after row6... no: see
//	                      below — row7 exists because the fixture's last byte is '\n').
//
// A second fixture (noTrailingNL) covers "a file with no trailing newline" separately, since that
// changes whether a final empty row exists at all.
const fixtureText = "abc\n\tx\nhi\r\né\n€\n😀\n\xffz\n"

func TestLineIndexByteOffsetAndPosition(t *testing.T) {
	li := NewLineIndex([]byte(fixtureText))

	// Rule 5: the trailing '\n' after row6 ("\xffz\n") produces one further, empty row.
	if got, want := li.LineCount(), 8; got != want {
		t.Fatalf("LineCount() = %d, want %d", got, want)
	}

	type wantCase struct {
		name           string
		line, column   int // Monaco's own 1-based line/UTF-16 column
		wantByteOffset int // absolute byte offset ByteOffset(line, column) must return
	}
	cases := []wantCase{
		// Rule 1 — plain ASCII, one byte per column.
		{"ascii col1", 1, 1, 0},
		{"ascii col2", 1, 2, 1},
		{"ascii col4 (end of line)", 1, 4, 3},
		{"ascii col past end clamps", 1, 99, 3},

		// Rule 4 — a leading tab is one UTF-16 unit, never expanded.
		{"tab col1 (the tab itself)", 2, 1, 4},
		{"tab col2 (right after the tab)", 2, 2, 5},
		{"tab col3 (after 'x')", 2, 3, 6},

		// Rule 1 — CRLF: the '\r' stays addressable as the line's own last byte; Monaco's line
		// content is "hi" only (2 code units), so the last valid column is 3 (right after 'i'),
		// which still maps to the '\r' byte's own offset — matching tree-sitter's own byte
		// counting on a CRLF file exactly.
		{"crlf col1", 3, 1, 7},
		{"crlf col3 (end of Monaco's own line content)", 3, 3, 9},
		{"crlf col past end clamps to before \\r", 3, 50, 9},

		// Rule 2 — a 2-byte and a 3-byte rune are each exactly one UTF-16 unit.
		{"2-byte rune col1", 4, 1, 11},
		{"2-byte rune col2 (past it)", 4, 2, 13},
		{"3-byte rune col1", 5, 1, 14},
		{"3-byte rune col2 (past it)", 5, 2, 17},

		// Rule 2 — the 4-byte emoji needs a surrogate pair: two UTF-16 units. column 2 sits
		// between the pair's two halves and must clamp to the rune's own first byte, never its
		// second (which is not a rune boundary at all).
		{"emoji col1 (first half)", 6, 1, 18},
		{"emoji col2 (between the pair's two halves, clamps to first byte)", 6, 2, 18},
		{"emoji col3 (right after it)", 6, 3, 22},

		// Rule 3 — an invalid UTF-8 byte is exactly one UTF-16 unit, same as any other rune.
		{"invalid byte col1", 7, 1, 23},
		{"invalid byte col2 (after it)", 7, 2, 24},
		{"invalid byte col3 (after 'z')", 7, 3, 25},

		// Rule 5 — the empty last line: only column 1 is valid, and it's the file's own length.
		{"empty last line col1", 8, 1, len(fixtureText)},
		{"empty last line col clamps", 8, 5, len(fixtureText)},

		// Rule 5 — an out-of-range line clamps to the first/last line rather than erroring.
		{"line 0 clamps to line 1", 0, 1, 0},
		{"line past end clamps to last line", 99, 1, len(fixtureText)},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := li.ByteOffset(c.line, c.column); got != c.wantByteOffset {
				t.Errorf("ByteOffset(%d, %d) = %d, want %d", c.line, c.column, got, c.wantByteOffset)
			}
		})
	}

	// Position is ByteOffset's own inverse direction: codegraph's 0-based row plus a byte column
	// relative to that row's own start.
	posCases := []struct {
		name                 string
		row, byteColumn      int
		wantLine, wantColumn int
	}{
		{"ascii row0 col0", 0, 0, 1, 1},
		{"ascii row0 col2", 0, 2, 1, 3},
		{"tab row1 col0", 1, 0, 2, 1},
		{"tab row1 col1 (after the tab)", 1, 1, 2, 2},
		{"crlf row2 col2 (the '\\r' itself)", 2, 2, 3, 3},
		{"2-byte rune row3 col0", 3, 0, 4, 1},
		{"2-byte rune row3 col2 (past it)", 3, 2, 4, 2},
		{"emoji row5 col0 (first half)", 5, 0, 6, 1},
		{"emoji row5 col4 (past it)", 5, 4, 6, 3},
		{"invalid byte row6 col0", 6, 0, 7, 1},
		{"invalid byte row6 col1 (after it)", 6, 1, 7, 2},
		{"row clamps below zero", -1, 0, 1, 1},
		{"row clamps past end", 99, 0, 8, 1},
	}
	for _, c := range posCases {
		t.Run(c.name, func(t *testing.T) {
			line, column := li.Position(c.row, c.byteColumn)
			if line != c.wantLine || column != c.wantColumn {
				t.Errorf("Position(%d, %d) = (%d, %d), want (%d, %d)",
					c.row, c.byteColumn, line, column, c.wantLine, c.wantColumn)
			}
		})
	}
}

// TestLineIndexRoundTrip is the case that actually catches an off-by-one in either direction that
// a one-directional table would miss (C6 §10): for every rune-boundary column on every fixture
// line (ASCII, tab, CRLF, multi-byte runes, a surrogate pair, an invalid byte, the empty last
// line), Position(ByteOffset(line, column)) must return exactly (line, column) back.
func TestLineIndexRoundTrip(t *testing.T) {
	for _, text := range []string{fixtureText, "no trailing newline at all"} {
		li := NewLineIndex([]byte(text))
		for row := 0; row < li.LineCount(); row++ {
			line := row + 1
			for _, column := range validColumnsFor(li, row) {
				off := li.ByteOffset(line, column)
				gotLine, gotColumn := li.Position(row, off-lineStart(li, row))
				if gotLine != line || gotColumn != column {
					t.Errorf("round trip for line %d col %d (text %q): ByteOffset->Position gave (%d, %d)",
						line, column, text, gotLine, gotColumn)
				}
			}
		}
	}
}

// lineStart re-derives one row's own starting byte offset the same way ByteOffset/Position do,
// for the round-trip test's own use converting an absolute offset back to a row-relative one.
func lineStart(li *LineIndex, row int) int {
	off := li.ByteOffset(row+1, 1)
	return off
}

// validColumnsFor enumerates every column that sits on a genuine rune boundary within row —
// exactly the columns ByteOffset/Position must agree on losslessly (a column landing mid-
// surrogate-pair is deliberately excluded: textpos.go's own rule 2 clamps it away from the second
// half by design, so it is not a round-trippable position).
func validColumnsFor(li *LineIndex, row int) []int {
	start := li.ByteOffset(row+1, 1)
	// ByteOffset's own end-of-line clamp (rule 5) gives the line's true end regardless of whether
	// a next line exists.
	end := li.ByteOffset(row+1, 1<<30)

	columns := []int{1}
	units := 1
	off := start
	data := []byte(fixtureTextFor(li))
	for off < end {
		r, size := utf8.DecodeRune(data[off:end])
		if r == utf8.RuneError && size <= 1 {
			units++
			off++
		} else if r > 0xFFFF {
			units += 2
			off += size
		} else {
			units++
			off += size
		}
		columns = append(columns, units)
	}
	return columns
}

// fixtureTextFor recovers the original text a *LineIndex was built over — the round-trip test's
// own helper has no other way to re-decode runes without duplicating LineIndex's private state.
func fixtureTextFor(li *LineIndex) string { return string(li.data) }
