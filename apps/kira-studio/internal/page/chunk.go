// Package page is the Go analogue of packages/shared/protocol/page.ts: the columnar TextColumnChunk
// codec, the four page-kind builders, and the byte-size accounting the L2 cache budgets against.
//
// Bulk data crosses the wire as base64 (P58 D5) rather than the Node engine's index-keyed JSON
// object form — a real memory/CPU win (§1.4 of docs/v1/plans/P58-go-native-adapters.md), not a
// cosmetic change: a 100 KB chunk inflates to ~1.33x on the wire here, against ~11x under the old
// stdio-JSON transport.
package page

import (
	"encoding/binary"
)

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
// Offsets and Truncated hold their values pre-encoded as exact little-endian bytes (rowCount+1 and
// len(truncated) uint32s respectively) rather than as []uint32 — encoding/json base64-encodes a
// []byte directly with no Marshaler round trip, which is the entire point (P4 D6): Go's default
// []uint32 encoding is a JSON number array anyway, so a typed wrapper with its own MarshalJSON was
// the only way to get the same base64 treatment Data/Nulls get for free, and that wrapper was the
// dominant cost (P4 F11). CellText below reads a value back out with binary.LittleEndian.
type Chunk struct {
	Data      []byte `json:"data"`
	Offsets   []byte `json:"offsets"`
	Nulls     []byte `json:"nulls"`
	Truncated []byte `json:"truncated"`
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
	start := binary.LittleEndian.Uint32(chunk.Offsets[row*4:])
	end := binary.LittleEndian.Uint32(chunk.Offsets[(row+1)*4:])
	return string(chunk.Data[start:end])
}

// ChunkByteSize is the real, measured byte cost of chunk — what L2 budgets against.
func ChunkByteSize(chunk Chunk) int {
	return len(chunk.Data) + len(chunk.Offsets) + len(chunk.Nulls) + len(chunk.Truncated)
}
