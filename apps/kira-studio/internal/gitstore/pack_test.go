package gitstore

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func rec(sha string, parents []string, subject string) porcelain.CommitRecord {
	return porcelain.CommitRecord{
		SHA:     sha,
		Parents: parents,
		Author:  porcelain.CommitIdentity{Name: "A", Email: "a@x.test", Timestamp: 100},
		Committer: porcelain.CommitIdentity{
			Name: "C", Email: "c@x.test", Timestamp: 200,
		},
		Subject: subject,
	}
}

const sha1 = "111111111111111111111111111111111111111a"
const sha2 = "222222222222222222222222222222222222222a"
const sha3 = "333333333333333333333333333333333333333a"
const sha4 = "444444444444444444444444444444444444444a"

func TestPackSlice_MidStoreRebasesParentOffsetsToZero(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	s.Append(rec(sha2, []string{sha1}, "one parent"))
	s.Append(rec(sha3, []string{sha2, sha1}, "two parents")) // a merge

	chunk := s.PackSlice(1, 3, s.interner.Size())
	want := []uint32{0, 1, 3} // row 1 has 1 parent, row 2 has 2 -- rebased to start at 0
	if !reflect.DeepEqual(chunk.ParentOffsets, want) {
		t.Fatalf("ParentOffsets = %v, want %v", chunk.ParentOffsets, want)
	}
	if len(chunk.ParentShas) != 3*20 {
		t.Fatalf("ParentShas length = %d, want %d", len(chunk.ParentShas), 3*20)
	}
}

func TestPackSlice_RootCommitHasEmptyParentRange(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))

	chunk := s.PackSlice(0, 1, 0)
	want := []uint32{0, 0}
	if !reflect.DeepEqual(chunk.ParentOffsets, want) {
		t.Fatalf("ParentOffsets = %v, want %v", chunk.ParentOffsets, want)
	}
	if len(chunk.ParentShas) != 0 {
		t.Fatalf("ParentShas = %v, want empty", chunk.ParentShas)
	}
}

func TestPackSlice_DictionaryDeltaAtCurrentSize(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	base := s.interner.Size()

	chunk := s.PackSlice(0, 1, base)
	if chunk.Dictionary != nil {
		t.Fatalf("Dictionary at base == interner size = %v, want nil (nothing new)", chunk.Dictionary)
	}
	if chunk.DictionaryBase != uint32(base) {
		t.Fatalf("DictionaryBase = %d, want %d", chunk.DictionaryBase, base)
	}
}

func TestPackSlice_DictionaryDeltaSeveralChunksBack(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	baseAfterFirst := s.interner.Size() // "A","a@x.test","C","c@x.test" all interned = 4
	s.Append(rec(sha2, []string{sha1}, "second"))

	chunk := s.PackSlice(1, 2, baseAfterFirst)
	// Second commit reuses the same author/committer identities -- nothing new to intern.
	if len(chunk.Dictionary) != 0 {
		t.Fatalf("Dictionary = %v, want empty (identities reused)", chunk.Dictionary)
	}

	// A base further back picks up the full set from that point forward.
	chunkFromZero := s.PackSlice(1, 2, 0)
	if len(chunkFromZero.Dictionary) != baseAfterFirst {
		t.Fatalf("Dictionary from base 0 = %v, want %d entries", chunkFromZero.Dictionary, baseAfterFirst)
	}
}

func TestPackSlice_ShaWidthBytesOnEmptyStore(t *testing.T) {
	s := New()
	if s.shaWidth != 0 {
		t.Fatalf("shaWidth on an empty store = %d, want 0 (fixed by the first Append)", s.shaWidth)
	}
	s.Append(rec(sha1, nil, "root"))
	chunk := s.PackSlice(0, 1, 0)
	if chunk.ShaWidthBytes != 20 {
		t.Fatalf("ShaWidthBytes = %d, want 20 (sha1)", chunk.ShaWidthBytes)
	}
}

func TestPackSlice_SubjectOffsetsRebased(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "aaa"))
	s.Append(rec(sha2, []string{sha1}, "bb"))
	s.Append(rec(sha3, []string{sha2}, "c"))

	chunk := s.PackSlice(1, 3, s.interner.Size())
	want := []uint32{0, 2, 3}
	if !reflect.DeepEqual(chunk.SubjectOffsets, want) {
		t.Fatalf("SubjectOffsets = %v, want %v", chunk.SubjectOffsets, want)
	}
	if string(chunk.SubjectBytes) != "bbc" {
		t.Fatalf("SubjectBytes = %q, want %q", chunk.SubjectBytes, "bbc")
	}
}

func TestPackSlice_DecorationsChunkRelative(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	r := rec(sha2, []string{sha1}, "decorated")
	r.Decoration = []porcelain.DecorationRef{{Kind: porcelain.DecorationBranch, Name: "main", IsHead: true}}
	s.Append(r)
	s.Append(rec(sha3, []string{sha2}, "third"))

	chunk := s.PackSlice(1, 3, s.interner.Size())
	if len(chunk.Decorations) != 1 || chunk.Decorations[0].Row != 0 {
		t.Fatalf("Decorations = %+v, want one entry at chunk-relative row 0", chunk.Decorations)
	}
}

func TestStore_Clear(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	s.Append(rec(sha2, []string{sha1}, "two"))
	s.Clear()
	if s.RowCount() != 0 || s.shaWidth != 0 || s.interner.Size() != 0 {
		t.Fatalf("after Clear: RowCount=%d shaWidth=%d internerSize=%d, want all zero", s.RowCount(), s.shaWidth, s.interner.Size())
	}
	// Clear must leave the store usable, not just zeroed.
	s.Append(rec(sha4, nil, "fresh"))
	if s.RowCount() != 1 {
		t.Fatalf("RowCount after re-append = %d, want 1", s.RowCount())
	}
}
