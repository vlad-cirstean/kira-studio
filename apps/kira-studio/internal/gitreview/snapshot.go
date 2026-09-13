package gitreview

import (
	"bytes"
	"compress/flate"
	"fmt"
	"io"
)

// ContentKind is one review_file row's own discriminant for what (if anything) its content column
// holds (D9).
type ContentKind string

const (
	// ContentText is the only kind that actually stores bytes.
	ContentText ContentKind = "text"
	// ContentBinary — looksBinary at mark time; change detection is exact through tier 0 (blob-oid
	// equality) regardless, so storing the bytes buys nothing.
	ContentBinary ContentKind = "binary"
	// ContentTooLarge — over MaxSnapshotBytes, or catfile.ErrTooLarge from the session's own gate.
	ContentTooLarge ContentKind = "tooLarge"
	// ContentAbsent — the path did not exist at reviewed_at_sha (reviewed as deleted).
	ContentAbsent ContentKind = "absent"
)

// MaxSnapshotBytes caps how large a file's UNCOMPRESSED content this package will ever store —
// gitsession.MaxPatchBytes's own sibling (D9/F15): a file whose content exceeds the size at which
// this chapter already refuses to render a patch is a file whose snapshot buys nothing.
const MaxSnapshotBytes = 1 << 20

// Compress flate-encodes raw at BestCompression — chosen over gzip (D9) because git's own blob oid
// (stored alongside every snapshot regardless) is already a stronger integrity check than gzip's
// CRC32 would add.
func Compress(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("gitreview: flate writer: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return nil, fmt.Errorf("gitreview: flate write: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("gitreview: flate close: %w", err)
	}
	return buf.Bytes(), nil
}

// Decompress flate-decodes compressed and checks the result's length against want (the row's own
// content_bytes column) — a corrupt or truncated BLOB is detected here (length mismatch) rather
// than silently producing a shorter file (D9).
func Decompress(compressed []byte, want int) ([]byte, error) {
	r := flate.NewReader(bytes.NewReader(compressed))
	defer r.Close()
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("gitreview: flate decode: %w", err)
	}
	if len(raw) != want {
		return nil, fmt.Errorf("gitreview: decompressed length %d does not match stored length %d", len(raw), want)
	}
	return raw, nil
}
