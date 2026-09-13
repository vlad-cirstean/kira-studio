package gitstore

import (
	"bytes"
	"encoding/binary"
	"reflect"
	"testing"

	flatbuffers "github.com/google/flatbuffers/go"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitwire"
)

// readUint32ColumnLE reads a `[ubyte]` wire column back as a []uint32, asserting it decodes
// little-endian — this is what actually proves F12/D12 rather than merely trusting the encoder.
func readUint32ColumnLE(t *testing.T, raw []byte) []uint32 {
	t.Helper()
	if len(raw)%4 != 0 {
		t.Fatalf("uint32 column length %d is not a multiple of 4", len(raw))
	}
	out := make([]uint32, len(raw)/4)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(raw[i*4 : i*4+4])
	}
	return out
}

func TestEncodeChunkFrame_RoundTrip(t *testing.T) {
	s := New()
	s.Append(rec(sha1, nil, "root"))
	r2 := rec(sha2, []string{sha1}, "second")
	r2.Decoration = []porcelain.DecorationRef{
		{Kind: porcelain.DecorationBranch, Name: "main", IsHead: true},
		{Kind: porcelain.DecorationStash, Index: 0},
	}
	s.Append(r2)
	s.Append(rec(sha3, []string{sha2}, "third"))

	chunk := s.PackSlice(0, 3, 0)
	frameBytes := EncodeChunkFrame(chunk)

	if !gitwire.FrameBufferHasIdentifier(frameBytes) {
		t.Fatal("encoded frame is missing the 'KIG1' file identifier")
	}

	frame := gitwire.GetRootAsFrame(frameBytes, 0)
	if frame.PayloadType() != gitwire.PayloadPackedCommitChunk {
		t.Fatalf("payload type = %v, want PackedCommitChunk", frame.PayloadType())
	}
	var unionTable flatbuffers.Table
	if !frame.Payload(&unionTable) {
		t.Fatal("Frame.Payload() returned false")
	}
	got := new(gitwire.PackedCommitChunk)
	got.Init(unionTable.Bytes, unionTable.Pos)

	if got.From() != uint32(chunk.From) || got.To() != uint32(chunk.To) {
		t.Fatalf("From/To = %d/%d, want %d/%d", got.From(), got.To(), chunk.From, chunk.To)
	}
	if got.ShaWidthBytes() != chunk.ShaWidthBytes {
		t.Fatalf("ShaWidthBytes = %d, want %d", got.ShaWidthBytes(), chunk.ShaWidthBytes)
	}
	if !bytes.Equal(got.ShasBytes(), chunk.Shas) {
		t.Fatalf("Shas mismatch")
	}
	if !bytes.Equal(got.ParentShasBytes(), chunk.ParentShas) {
		t.Fatalf("ParentShas mismatch")
	}
	if !bytes.Equal(got.SubjectBytesBytes(), chunk.SubjectBytes) {
		t.Fatalf("SubjectBytes mismatch: got %q want %q", got.SubjectBytesBytes(), chunk.SubjectBytes)
	}

	gotParentOffsets := readUint32ColumnLE(t, got.ParentOffsetsBytes())
	if !reflect.DeepEqual(gotParentOffsets, chunk.ParentOffsets) {
		t.Fatalf("ParentOffsets = %v, want %v", gotParentOffsets, chunk.ParentOffsets)
	}
	gotSubjectOffsets := readUint32ColumnLE(t, got.SubjectOffsetsBytes())
	if !reflect.DeepEqual(gotSubjectOffsets, chunk.SubjectOffsets) {
		t.Fatalf("SubjectOffsets = %v, want %v", gotSubjectOffsets, chunk.SubjectOffsets)
	}
	gotIdentityIDs := readUint32ColumnLE(t, got.IdentityIdsBytes())
	if !reflect.DeepEqual(gotIdentityIDs, chunk.IdentityIDs) {
		t.Fatalf("IdentityIds = %v, want %v", gotIdentityIDs, chunk.IdentityIDs)
	}
	gotTimes := readUint32ColumnLE(t, got.TimesBytes())
	if !reflect.DeepEqual(gotTimes, chunk.Times) {
		t.Fatalf("Times = %v, want %v", gotTimes, chunk.Times)
	}

	if got.DictionaryBase() != chunk.DictionaryBase {
		t.Fatalf("DictionaryBase = %d, want %d", got.DictionaryBase(), chunk.DictionaryBase)
	}
	if got.DictionaryLength() != len(chunk.Dictionary) {
		t.Fatalf("DictionaryLength = %d, want %d", got.DictionaryLength(), len(chunk.Dictionary))
	}
	for i, want := range chunk.Dictionary {
		if string(got.Dictionary(i)) != want {
			t.Fatalf("Dictionary[%d] = %q, want %q", i, got.Dictionary(i), want)
		}
	}

	if got.DecorationsLength() != len(chunk.Decorations) {
		t.Fatalf("DecorationsLength = %d, want %d", got.DecorationsLength(), len(chunk.Decorations))
	}
	var rd gitwire.RowDecorations
	if !got.Decorations(&rd, 0) {
		t.Fatal("Decorations(0) returned false")
	}
	if rd.Row() != uint32(chunk.Decorations[0].Row) {
		t.Fatalf("Decorations[0].Row = %d, want %d", rd.Row(), chunk.Decorations[0].Row)
	}
	if rd.RefsLength() != len(chunk.Decorations[0].Refs) {
		t.Fatalf("Decorations[0].RefsLength = %d, want %d", rd.RefsLength(), len(chunk.Decorations[0].Refs))
	}
	var ref0 gitwire.DecorationRef
	if !rd.Refs(&ref0, 0) {
		t.Fatal("Refs(0) returned false")
	}
	if string(ref0.Kind()) != "branch" || string(ref0.Name()) != "main" || !ref0.IsHead() {
		t.Fatalf("Refs[0] = kind=%q name=%q isHead=%v, want branch/main/true", ref0.Kind(), ref0.Name(), ref0.IsHead())
	}
	var ref1 gitwire.DecorationRef
	if !rd.Refs(&ref1, 1) {
		t.Fatal("Refs(1) returned false")
	}
	if string(ref1.Kind()) != "stash" || string(ref1.Name()) != "0" {
		t.Fatalf("Refs[1] = kind=%q name=%q, want stash/0", ref1.Kind(), ref1.Name())
	}
}
