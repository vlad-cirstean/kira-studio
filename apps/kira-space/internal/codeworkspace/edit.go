package codeworkspace

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"unicode/utf8"

	"github.com/google/renameio/v2"
)

var (
	// ErrConflict means the file on disk no longer matches the caller's base hash.
	ErrConflict = errors.New("codeworkspace: file changed on disk")
	// ErrTooLarge means the text to save exceeds MaxReadBytes, so the viewer could not reopen it.
	ErrTooLarge = errors.New("codeworkspace: text exceeds the size limit")
	// ErrNotRegular means the save target exists but is not a regular file.
	ErrNotRegular = errors.New("codeworkspace: target is not a regular file")
	// ErrInvalidUTF8 means the text to save is not valid UTF-8.
	ErrInvalidUTF8 = errors.New("codeworkspace: text is not valid UTF-8")
)

// EditContent is the edit session's read: FileContent's classification plus the on-disk hash that
// guards the later save, and `notUtf8` for a found file that JSON cannot carry byte-exact.
type EditContent struct {
	Kind     string `json:"kind"` // found | missing | binary | tooLarge | notUtf8
	Text     string `json:"text"`
	Hash     string `json:"hash"`
	Language string `json:"language"`
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ReadFileForEdit reads absPath like ReadFile and adds the SHA-256 of the on-disk bytes. Text that
// is not valid UTF-8 is refused: JSON would replace the bad bytes and a save would corrupt the file.
func ReadFileForEdit(absPath, relPath string) (EditContent, error) {
	fc, err := ReadFile(absPath, relPath)
	if err != nil {
		return EditContent{}, err
	}
	out := EditContent{Kind: fc.Kind, Language: fc.Language}
	if fc.Kind != "found" {
		return out, nil
	}
	if !utf8.ValidString(fc.Text) {
		out.Kind = "notUtf8"
		return out, nil
	}
	out.Text = fc.Text
	out.Hash = hashBytes([]byte(fc.Text))
	return out, nil
}

// currentHash hashes absPath's bytes, "" when it is absent. Callers have already lstat-checked the
// type; the read is bounded so a file grown past the limit cannot load unbounded.
func currentHash(absPath string) (string, error) {
	f, err := os.Open(absPath) //nolint:gosec // absPath validated by the caller; type checked before.
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("codeworkspace: open for save: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxReadBytes+1))
	if err != nil {
		return "", fmt.Errorf("codeworkspace: read for save: %w", err)
	}
	return hashBytes(data), nil
}

// WriteFile atomically replaces absPath with text when its current hash equals baseHash ("" means
// the file must be absent), and returns the new hash. The caller serializes calls (steps hash,
// compare, replace are not atomic against an external writer). Existing permissions are kept; a
// recreated file gets 0644 minus umask.
func WriteFile(absPath, text, baseHash string) (string, error) {
	if len(text) > MaxReadBytes {
		return "", ErrTooLarge
	}
	if !utf8.ValidString(text) {
		return "", ErrInvalidUTF8
	}
	// absPath is the symlink-resolved target, so Stat sees the real file.
	info, err := os.Stat(absPath)
	switch {
	case err == nil && !info.Mode().IsRegular():
		return "", ErrNotRegular
	case err != nil && !os.IsNotExist(err):
		return "", fmt.Errorf("codeworkspace: stat for save: %w", err)
	}
	cur, err := currentHash(absPath)
	if err != nil {
		return "", err
	}
	if cur != baseHash {
		return "", ErrConflict
	}
	pf, err := renameio.NewPendingFile(absPath, renameio.WithExistingPermissions(), renameio.WithPermissions(0o644))
	if err != nil {
		return "", fmt.Errorf("codeworkspace: save %s: %w", absPath, err)
	}
	defer func() { _ = pf.Cleanup() }()
	if _, err := pf.WriteString(text); err != nil {
		return "", fmt.Errorf("codeworkspace: save %s: %w", absPath, err)
	}
	if err := pf.CloseAtomicallyReplace(); err != nil {
		return "", fmt.Errorf("codeworkspace: save %s: %w", absPath, err)
	}
	return hashBytes([]byte(text)), nil
}
