package codeparse

import (
	"testing"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// TestDeriveEdit is §11 point 1: prefix/suffix boundary arithmetic, points by newline counting,
// the overlap clamp, the UTF-8 boundary walk, an empty file, an append-only change, a
// truncate-to-empty change, and an unchanged file (no edit at all).
func TestDeriveEdit(t *testing.T) {
	cases := []struct {
		name     string
		old, new string
		wantOK   bool
		want     sitter.InputEdit
	}{
		{
			name: "unchanged file produces no edit",
			old:  "line one\nline two\n", new: "line one\nline two\n",
			wantOK: false,
		},
		{
			name: "empty old, insert into empty file",
			old:  "", new: "x",
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 0, OldEndByte: 0, NewEndByte: 1,
				StartPosition: sitter.Point{Row: 0, Column: 0},
				OldEndPosition: sitter.Point{Row: 0, Column: 0},
				NewEndPosition: sitter.Point{Row: 0, Column: 1},
			},
		},
		{
			name: "truncate to empty",
			old:  "hello\nworld", new: "",
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 0, OldEndByte: 11, NewEndByte: 0,
				StartPosition:  sitter.Point{Row: 0, Column: 0},
				OldEndPosition: sitter.Point{Row: 1, Column: 5}, // "hello\nworld" ends on row 1, col 5.
				NewEndPosition: sitter.Point{Row: 0, Column: 0},
			},
		},
		{
			name: "append-only change",
			old:  "abc\n", new: "abc\ndef\n",
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 4, OldEndByte: 4, NewEndByte: 8,
				StartPosition:  sitter.Point{Row: 1, Column: 0},
				OldEndPosition: sitter.Point{Row: 1, Column: 0},
				NewEndPosition: sitter.Point{Row: 2, Column: 0},
			},
		},
		{
			name: "prepend-only change",
			old:  "world", new: "hello world",
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 0, OldEndByte: 0, NewEndByte: 6,
				StartPosition:  sitter.Point{Row: 0, Column: 0},
				OldEndPosition: sitter.Point{Row: 0, Column: 0},
				NewEndPosition: sitter.Point{Row: 0, Column: 6},
			},
		},
		{
			name: "middle replacement across a newline",
			old:  "one\ntwo\nthree\n", new: "one\nTWO-CHANGED\nthree\n",
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 4, OldEndByte: 7, NewEndByte: 15,
				StartPosition:  sitter.Point{Row: 1, Column: 0},
				OldEndPosition: sitter.Point{Row: 1, Column: 3},
				NewEndPosition: sitter.Point{Row: 1, Column: 11},
			},
		},
		{
			// old="a" + é(U+00E9, 0xC3 0xA9) + "b"; new="a" + ï(U+00EF, 0xC3 0xAF) + "b" —
			// both share the same lead byte 0xC3, so a naive byte-prefix scan would stop at
			// prefix=2, splitting the multi-byte sequence after its lead byte. The boundary
			// walk must back prefix off to 1.
			name: "UTF-8 boundary walk: shared lead byte between two 2-byte characters",
			old:  string([]byte{'a', 0xC3, 0xA9, 'b'}), new: string([]byte{'a', 0xC3, 0xAF, 'b'}),
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 1, OldEndByte: 3, NewEndByte: 3,
				StartPosition:  sitter.Point{Row: 0, Column: 1},
				OldEndPosition: sitter.Point{Row: 0, Column: 3},
				NewEndPosition: sitter.Point{Row: 0, Column: 3},
			},
		},
		{
			// The suffix side of the same boundary rule: old ends in é, new ends in a
			// differently-accented character sharing the same lead byte, with a common
			// prefix so the suffix scan (not the prefix scan) is what would split it if
			// only the raw byte-matching loop ran with no clamp/boundary logic at all —
			// exercised via the prefix walk regardless, since both scans feed the same
			// boundary correction on the START side; this case pins down that a match
			// confined entirely to the interior of one multi-byte sequence doesn't produce
			// a false-positive common byte across two different code points.
			name: "no accidental partial match across two different accented characters",
			old:  string([]byte{'x', 0xC3, 0xA9}), new: string([]byte{'x', 0xC3, 0xAF}),
			wantOK: true,
			want: sitter.InputEdit{
				StartByte: 1, OldEndByte: 3, NewEndByte: 3,
				StartPosition:  sitter.Point{Row: 0, Column: 1},
				OldEndPosition: sitter.Point{Row: 0, Column: 3},
				NewEndPosition: sitter.Point{Row: 0, Column: 3},
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := DeriveEdit([]byte(c.old), []byte(c.new))
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if !ok {
				return
			}
			if got != c.want {
				t.Fatalf("DeriveEdit(%q, %q) =\n  %+v\nwant\n  %+v", c.old, c.new, got, c.want)
			}
		})
	}
}
