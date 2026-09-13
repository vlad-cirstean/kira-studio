// Package page is the Go analogue of packages/shared/protocol/page.ts: the columnar TextColumnChunk
// codec, the four page-kind builders, and the byte-size accounting the L2 cache budgets against.
//
// Bulk data crosses the wire as a FlatBuffers Frame (P11), not JSON+base64 (superseding P58 D5):
// EncodePage (encode.go) writes a Chunk's four buffers into a FlatBuffers table with zero copying
// on the decode side — offsets/truncated are [uint32] vectors specifically so the generated
// TypeScript can hand back a zero-copy Uint32Array view (P11 D4).
package page

// Constants, from page.ts:175-197.
const (
	MaxCellBytes                = 64 << 10
	MaxPageSize                 = 10_000
	DocumentTruncateBytes       = MaxCellBytes
	DocumentTruncateBytesSingle = MaxCellBytes * 64
	ObjectBodyPreviewBytes      = DocumentTruncateBytesSingle
	ObjectBodyEditBytes         = MaxCellBytes * 16
	ObjectUploadMaxBytes        = 5 << 30

	// columnEnvelopeBytes is the per-column object overhead estimate pageByteSize adds — a
	// measurement, not a guess (page.ts's own comment); changing it changes L2 eviction behaviour.
	columnEnvelopeBytes = 64
)

// Chunk is the Go analogue of page.ts's TextColumnChunk. Three exactly-sized buffers and no
// per-row object:
//
//	text of row i = utf8.decode(Data[Offsets[i]:Offsets[i+1]])
//	row i is NULL  = (Nulls[i>>3] & (1 << (i&7))) != 0
//
// A NULL row has Offsets[i] == Offsets[i+1]; an empty string does too, which is why the bitset is
// the only thing that distinguishes them — every value reaching a builder is a *string all the way
// from the driver's row scan, never a bare "" standing in for NULL.
//
// Offsets and Truncated are []uint32, not []byte (P11 D4/D7) — EncodePage writes each as a
// FlatBuffers [uint] vector, which is 4-byte aligned by construction, letting the generated
// TypeScript decoder hand back a zero-copy Uint32Array view over the received frame instead of a
// manual byte-by-byte reinterpretation.
type Chunk struct {
	Data      []byte
	Offsets   []uint32
	Nulls     []byte
	Truncated []uint32
}

func bitsetBytes(rowCount int) int {
	return (rowCount + 7) / 8
}

// IsNull reports whether row is NULL in chunk.
func IsNull(chunk Chunk, row int) bool {
	return chunk.Nulls[row>>3]&(1<<(row&7)) != 0
}

// CellText decodes row's text out of chunk.
func CellText(chunk Chunk, row int) string {
	return string(chunk.Data[chunk.Offsets[row]:chunk.Offsets[row+1]])
}

// ChunkByteSize is the real, measured byte cost of chunk — what L2 budgets against. Unchanged by
// P11's []byte->[]uint32 switch: four uint32s of pre-encoded little-endian bytes and one []uint32
// of the same four bytes each cost exactly the same number of bytes.
func ChunkByteSize(chunk Chunk) int {
	return len(chunk.Data) + len(chunk.Offsets)*4 + len(chunk.Nulls) + len(chunk.Truncated)*4
}
