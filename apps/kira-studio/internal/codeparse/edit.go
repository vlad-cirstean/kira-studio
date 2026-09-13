package codeparse

import (
	"bytes"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// DeriveEdit computes §7.2's single-replacement InputEdit describing the difference between old
// and new whole-file content, when no editor-supplied edit exists (the realistic case: an
// external tool rewrote the file). It finds the common byte prefix and suffix — clamped so they
// never overlap — and reports everything between them as one replacement: not minimal in an
// edit-distance sense, but truthful, which is all Tree.Edit plus a reparse needs to reuse every
// subtree outside that range.
//
// ok is false when old and new are byte-identical: there is nothing to derive, and Session skips
// the incremental path entirely rather than handing tree-sitter a zero-width edit.
func DeriveEdit(old, new []byte) (edit sitter.InputEdit, ok bool) {
	if bytes.Equal(old, new) {
		return sitter.InputEdit{}, false
	}

	maxCommon := len(old)
	if len(new) < maxCommon {
		maxCommon = len(new)
	}

	prefix := 0
	for prefix < maxCommon && old[prefix] == new[prefix] {
		prefix++
	}

	// Suffix is bounded by maxCommon-prefix (not maxCommon alone), which is what keeps the two
	// scans from ever overlapping — a suffix byte can only be "common" up to the point the
	// prefix scan already claimed.
	suffix := 0
	limit := maxCommon - prefix
	for suffix < limit && old[len(old)-1-suffix] == new[len(new)-1-suffix] {
		suffix++
	}

	// A Point's column is a byte column (§5.2), so a prefix ending mid-multi-byte-sequence
	// would make the reported column meaningless. Walk back to a real boundary: a continuation
	// byte (10xxxxxx, 0x80-0xBF) at old[prefix] means the byte(s) just before it started a
	// sequence this prefix split — back off until that is no longer true, or prefix is 0.
	for prefix > 0 && prefix < len(old) && isUTF8Continuation(old[prefix]) {
		prefix--
	}

	startByte := prefix
	oldEndByte := len(old) - suffix
	newEndByte := len(new) - suffix

	return sitter.InputEdit{
		StartByte:      uint(startByte),
		OldEndByte:     uint(oldEndByte),
		NewEndByte:     uint(newEndByte),
		StartPosition:  pointAtBytes(old, startByte).toTS(),
		OldEndPosition: pointAtBytes(old, oldEndByte).toTS(),
		NewEndPosition: pointAtBytes(new, newEndByte).toTS(),
	}, true
}

func isUTF8Continuation(b byte) bool { return b&0xC0 == 0x80 }

// pointAtBytes counts newlines in content[:offset] to derive a row/column position — the same
// row/column shape as pointOf, but computed by scanning bytes rather than reading a *sitter.Node
// (DeriveEdit runs on plain content, before any tree exists for the new side).
func pointAtBytes(content []byte, offset int) Point {
	row := 0
	lastNewline := -1
	for i := 0; i < offset; i++ {
		if content[i] == '\n' {
			row++
			lastNewline = i
		}
	}
	return Point{Row: row, Column: offset - lastNewline - 1}
}

func (p Point) toTS() sitter.Point {
	return sitter.Point{Row: uint(p.Row), Column: uint(p.Column)}
}
