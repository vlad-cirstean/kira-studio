package gitstore

import (
	"encoding/binary"
	"strconv"

	flatbuffers "github.com/google/flatbuffers/go"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitwire"
)

// EncodeChunkFrame builds one gitwire.Frame wrapping chunk as its PackedCommitChunk payload,
// finished with the "KIG1" file identifier (D1/D12) — the git data plane's own wire bytes for one
// graph.stream chunk.
//
// Every uint32 column crosses little-endian, converted in exactly this one place
// (createUint32VectorLE, below) — F12: the TypeScript receiver reconstructs native typed arrays
// (`new Uint32Array(...)`), so the byte order is the encoder's responsibility. No host-endianness
// fast path (unlike internal/page/encode.go's, which exists because it encodes multi-megabyte
// result pages): a 500-row commit chunk is a few thousand uint32s, where the fast path would buy
// microseconds against a host-endianness branch this package would otherwise never need (D12).
func EncodeChunkFrame(chunk PackedChunk) []byte {
	b := flatbuffers.NewBuilder(estimateChunkSize(chunk))

	// Nested tables leaf-first: each row's DecorationRefs, then its RowDecorations, before the
	// chunk-level decorations vector that references them all.
	rowOffsets := make([]flatbuffers.UOffsetT, len(chunk.Decorations))
	for i, rd := range chunk.Decorations {
		refOffsets := make([]flatbuffers.UOffsetT, len(rd.Refs))
		for j, ref := range rd.Refs {
			refOffsets[j] = encodeDecorationRef(b, ref)
		}
		gitwire.RowDecorationsStartRefsVector(b, len(refOffsets))
		for i2 := len(refOffsets) - 1; i2 >= 0; i2-- {
			b.PrependUOffsetT(refOffsets[i2])
		}
		refsVec := b.EndVector(len(refOffsets))

		gitwire.RowDecorationsStart(b)
		gitwire.RowDecorationsAddRow(b, uint32(rd.Row))
		gitwire.RowDecorationsAddRefs(b, refsVec)
		rowOffsets[i] = gitwire.RowDecorationsEnd(b)
	}
	gitwire.PackedCommitChunkStartDecorationsVector(b, len(rowOffsets))
	for i := len(rowOffsets) - 1; i >= 0; i-- {
		b.PrependUOffsetT(rowOffsets[i])
	}
	decorationsVec := b.EndVector(len(rowOffsets))

	dictOffsets := make([]flatbuffers.UOffsetT, len(chunk.Dictionary))
	for i, s := range chunk.Dictionary {
		dictOffsets[i] = b.CreateString(s)
	}
	gitwire.PackedCommitChunkStartDictionaryVector(b, len(dictOffsets))
	for i := len(dictOffsets) - 1; i >= 0; i-- {
		b.PrependUOffsetT(dictOffsets[i])
	}
	dictVec := b.EndVector(len(dictOffsets))

	// Every column vector is created unconditionally, even at zero length (a root commit's empty
	// ParentShas, a chunk with no dictionary delta) — an omitted `(required)` field would decode
	// as an error on the TypeScript side, not a zero-length vector.
	shasVec := b.CreateByteVector(chunk.Shas)
	parentOffsetsVec := createUint32VectorLE(b, chunk.ParentOffsets)
	parentShasVec := b.CreateByteVector(chunk.ParentShas)
	identityIDsVec := createUint32VectorLE(b, chunk.IdentityIDs)
	timesVec := createUint32VectorLE(b, chunk.Times)
	subjectBytesVec := b.CreateByteVector(chunk.SubjectBytes)
	subjectOffsetsVec := createUint32VectorLE(b, chunk.SubjectOffsets)

	gitwire.PackedCommitChunkStart(b)
	gitwire.PackedCommitChunkAddFrom(b, uint32(chunk.From))
	gitwire.PackedCommitChunkAddTo(b, uint32(chunk.To))
	gitwire.PackedCommitChunkAddShaWidthBytes(b, chunk.ShaWidthBytes)
	gitwire.PackedCommitChunkAddShas(b, shasVec)
	gitwire.PackedCommitChunkAddParentOffsets(b, parentOffsetsVec)
	gitwire.PackedCommitChunkAddParentShas(b, parentShasVec)
	gitwire.PackedCommitChunkAddIdentityIds(b, identityIDsVec)
	gitwire.PackedCommitChunkAddTimes(b, timesVec)
	gitwire.PackedCommitChunkAddSubjectBytes(b, subjectBytesVec)
	gitwire.PackedCommitChunkAddSubjectOffsets(b, subjectOffsetsVec)
	gitwire.PackedCommitChunkAddDictionaryBase(b, chunk.DictionaryBase)
	gitwire.PackedCommitChunkAddDictionary(b, dictVec)
	gitwire.PackedCommitChunkAddDecorations(b, decorationsVec)
	chunkOffset := gitwire.PackedCommitChunkEnd(b)

	gitwire.FrameStart(b)
	gitwire.FrameAddPayloadType(b, gitwire.PayloadPackedCommitChunk)
	gitwire.FrameAddPayload(b, chunkOffset)
	frameOffset := gitwire.FrameEnd(b)

	gitwire.FinishFrameBuffer(b, frameOffset)
	return b.FinishedBytes()
}

// estimateChunkSize gives flatbuffers.NewBuilder a starting size close to the final one, so it
// rarely has to grow-and-copy its backing buffer — the same reasoning adapterhost/frame.go's own
// estimateFrameSize applies, sized off the raw byte columns that dominate a chunk's weight.
func estimateChunkSize(chunk PackedChunk) int {
	raw := len(chunk.Shas) + len(chunk.ParentShas) + len(chunk.SubjectBytes) +
		len(chunk.ParentOffsets)*4 + len(chunk.IdentityIDs)*4 + len(chunk.Times)*4 + len(chunk.SubjectOffsets)*4
	return raw + raw/8 + 512
}

func encodeDecorationRef(b *flatbuffers.Builder, ref porcelain.DecorationRef) flatbuffers.UOffsetT {
	kindOffset := b.CreateString(string(ref.Kind))
	var nameOffset flatbuffers.UOffsetT
	isHead := false
	switch ref.Kind {
	case porcelain.DecorationBranch:
		nameOffset = b.CreateString(ref.Name)
		isHead = ref.IsHead
	case porcelain.DecorationRemoteBranch, porcelain.DecorationTag:
		nameOffset = b.CreateString(ref.Name)
	case porcelain.DecorationHead:
		// no name slot.
	case porcelain.DecorationStash:
		// D1/upstream's own convention: the schema has no numeric slot for a stash decoration, so
		// the index travels in the otherwise-unused "name" string slot as its decimal form
		// (graphChunkCodec.ts's toWire carries the identical convention on the TS encode side).
		nameOffset = b.CreateString(strconv.Itoa(ref.Index))
	}

	gitwire.DecorationRefStart(b)
	gitwire.DecorationRefAddKind(b, kindOffset)
	if nameOffset != 0 {
		gitwire.DecorationRefAddName(b, nameOffset)
	}
	gitwire.DecorationRefAddIsHead(b, isHead)
	return gitwire.DecorationRefEnd(b)
}

// createUint32VectorLE writes v as a `[ubyte]` wire column of little-endian uint32 elements.
func createUint32VectorLE(b *flatbuffers.Builder, v []uint32) flatbuffers.UOffsetT {
	raw := make([]byte, len(v)*4)
	for i, x := range v {
		binary.LittleEndian.PutUint32(raw[i*4:], x)
	}
	return b.CreateByteVector(raw)
}
