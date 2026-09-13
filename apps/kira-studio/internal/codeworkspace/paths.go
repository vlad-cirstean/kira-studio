package codeworkspace

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrPathEscapesRoot is returned by ValidateRelPath for every shape of escape it catches — an
// absolute path, a ".." segment, or a symlink (ancestor directory or leaf) resolving outside root.
var ErrPathEscapesRoot = errors.New("codeworkspace: path escapes repository root")

// ValidateRelPath is §11's whole path-safety boundary: reject an absolute path, reject any ".."
// segment, then resolve the joined path with filepath.EvalSymlinks and require the result to
// remain under root. A repository can contain a symlink pointing anywhere on the machine, so
// resolving before the containment check — not after joining alone — is what actually prevents
// this read-only viewer from being used to read ~/.ssh/id_rsa.
//
// EvalSymlinks requires its argument to exist, which a listed-but-since-deleted file (a race
// between ListFiles and ReadFile) would not — that case carries no traversal risk (nothing to
// resolve through), so it falls back to resolving the parent directory only and joining the leaf
// name back on, leaving the caller's own os.Stat/os.Open to report it missing rather than this
// function misreporting a benign race as a security failure.
func ValidateRelPath(root, relPath string) (string, error) {
	if relPath == "" {
		return "", fmt.Errorf("codeworkspace: path is required")
	}
	if filepath.IsAbs(relPath) {
		return "", fmt.Errorf("%w: absolute path", ErrPathEscapesRoot)
	}
	cleaned := filepath.Clean(relPath)
	for _, seg := range strings.Split(cleaned, string(filepath.Separator)) {
		if seg == ".." {
			return "", fmt.Errorf("%w: %q", ErrPathEscapesRoot, relPath)
		}
	}

	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("codeworkspace: resolve root: %w", err)
	}

	joined := filepath.Join(root, cleaned)
	if resolved, err := filepath.EvalSymlinks(joined); err == nil {
		return requireUnder(resolvedRoot, resolved)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("codeworkspace: resolve %q: %w", relPath, err)
	}

	// The leaf itself doesn't exist (or a component of it doesn't) — resolve as far as the parent
	// directory, which for any file codeworkspace.ListFiles ever named must exist.
	dir, base := filepath.Split(joined)
	resolvedDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("codeworkspace: resolve %q: %w", relPath, err)
	}
	return requireUnder(resolvedRoot, filepath.Join(resolvedDir, base))
}

// requireUnder returns resolved unchanged when it is root or a descendant of it, else
// ErrPathEscapesRoot — the one containment check both ValidateRelPath branches funnel through.
func requireUnder(root, resolved string) (string, error) {
	if resolved == root {
		return resolved, nil
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrPathEscapesRoot
	}
	return resolved, nil
}
