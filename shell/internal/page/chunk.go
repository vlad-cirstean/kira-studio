// Package page is the Go analogue of src/shared/protocol/page.ts: the columnar TextColumnChunk
// codec, the four page-kind builders, and the byte-size accounting the L2 cache budgets against.
//
// Bulk data crosses the wire as base64 (P58 D5) rather than the Node engine's index-keyed JSON
// object form — a real memory/CPU win (§1.4 of docs/v1/plans/P58-go-native-adapters.md), not a
// cosmetic change: a 100 KB chunk inflates to ~1.33x on the wire here, against ~11x under the old
// stdio-JSON transport.
package page

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
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

// Uint32LE marshals as base64 of its exact little-endian bytes, so all four of a chunk's buffers
// decode through one renderer-side function (reviveChunks' toTypedArray, P58 D5/A9). Go's default
// []uint32 encoding is a JSON number array (~7 bytes per 4-byte value) — this type exists so
// Offsets/Truncated get the same base64 treatment []byte gets automatically.
type Uint32LE []uint32

func (v Uint32LE) MarshalJSON() ([]byte, error) {
	buf := make([]byte, len(v)*4)
	for i, x := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], x)
	}
	return json.Marshal(buf)
}

// UnmarshalJSON exists so the Go test tier can round-trip a page through JSON and compare — it is
// never used in production, where Go only ever encodes.
func (v *Uint32LE) UnmarshalJSON(b []byte) error {
	var encoded string
	if err := json.Unmarshal(b, &encoded); err != nil {
		return fmt.Errorf("page: Uint32LE: %w", err)
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("page: Uint32LE: %w", err)
	}
	if len(raw)%4 != 0 {
		return fmt.Errorf("page: Uint32LE: %d bytes is not a multiple of 4", len(raw))
	}
	out := make(Uint32LE, len(raw)/4)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	*v = out
	return nil
}

// Chunk is the Go analogue of page.ts's TextColumnChunk. Three exactly-sized buffers and no
// per-row object:
//
//	text of row i = utf8.decode(Data[Offsets[i]:Offsets[i+1]])
//	row i is NULL  = (Nulls[i>>3] & (1 << (i&7))) != 0
//
// A NULL row has Offsets[i] == Offsets[i+1]; an empty string does too, which is why the bitset is
// the only thing that distinguishes them — every value reaching a builder is a *string all the way
// from the driver's row scan, never a bare "" standing in for NULL.
type Chunk struct {
	Data      []byte   `json:"data"`
	Offsets   Uint32LE `json:"offsets"`
	Nulls     []byte   `json:"nulls"`
	Truncated Uint32LE `json:"truncated"`
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

// IsTruncated reports whether row's text was cut at MaxCellBytes.
func IsTruncated(chunk Chunk, row int) bool {
	for _, r := range chunk.Truncated {
		if int(r) == row {
			return true
		}
		if int(r) > row {
			break // Truncated is sorted ascending
		}
	}
	return false
}

// ChunkByteSize is the real, measured byte cost of chunk — what L2 budgets against.
func ChunkByteSize(chunk Chunk) int {
	return len(chunk.Data) + len(chunk.Offsets)*4 + len(chunk.Nulls) + len(chunk.Truncated)*4
}
