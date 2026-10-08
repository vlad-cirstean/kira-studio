// Package importer is the Memory module's bulk document import: scan, chunk, two Claude steps
// (extract facts per chunk, store them per file), all state in memory.db so it resumes after a
// restart.
package importer

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"unicode/utf8"
)

const binarySniffBytes = 8000

// ReadText reads one candidate file. A non-empty skipReason means the file is not importable; err
// is a real I/O failure. The returned text has its BOM stripped and newlines normalised to LF, and
// hash is the SHA-256 (hex) of that text.
func ReadText(path string, max int64) (text, hash, skipReason string, err error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", "", "", err
	}
	if info.Size() > max {
		return "", "", tooLarge(max), nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", "", err
	}
	if int64(len(raw)) > max {
		return "", "", tooLarge(max), nil
	}
	if bytes.IndexByte(raw[:min(len(raw), binarySniffBytes)], 0) >= 0 {
		return "", "", "binary", nil
	}
	if !utf8.Valid(raw) {
		return "", "", "not UTF-8 text", nil
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	raw = bytes.ReplaceAll(raw, []byte("\r"), []byte("\n"))
	if len(bytes.TrimSpace(raw)) == 0 {
		return "", "", "empty", nil
	}
	sum := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(sum[:]), "", nil
}

func tooLarge(max int64) string { return fmt.Sprintf("too large (limit %d KB)", max>>10) }
