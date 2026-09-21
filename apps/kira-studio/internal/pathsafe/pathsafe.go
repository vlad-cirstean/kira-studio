// Package pathsafe is a leaf package (zero internal imports, internal/gitpath's own precedent):
// the repository-relative path-containment check several otherwise-unrelated packages need and
// share no sane common import for (C8 plan D6). codeworkspace/paths.go's ValidateRelPath delegates
// here; codeworkspace/search.go calls it directly for its own per-match path check.
package pathsafe

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrPathEscapesRoot is returned by ValidateRelPath for every shape of escape it catches — an
// absolute path, a ".." segment, or a symlink (ancestor directory or leaf) resolving outside root.
var ErrPathEscapesRoot = errors.New("pathsafe: path escapes repository root")

// ValidateRelPath is codeworkspace's own §11 path-safety boundary, moved here unchanged in
// behaviour: reject an absolute path, reject any ".." segment, then resolve the joined path with
// filepath.EvalSymlinks and require the result to remain under root. A repository can contain a
// symlink pointing anywhere on the machine, so resolving before the containment check — not after
// joining alone — is what actually prevents a read-only caller from being used to read
// ~/.ssh/id_rsa.
//
// EvalSymlinks requires its argument to exist, which a listed-but-since-deleted file (a race
// between listing and reading) would not — that case carries no traversal risk (nothing to resolve
// through), so it falls back to resolving the parent directory only and joining the leaf name back
// on, leaving the caller's own os.Stat/os.Open to report it missing rather than this function
// misreporting a benign race as a security failure.
func ValidateRelPath(root, relPath string) (string, error) {
	if relPath == "" {
		return "", fmt.Errorf("pathsafe: path is required")
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
		return "", fmt.Errorf("pathsafe: resolve root: %w", err)
	}

	joined := filepath.Join(root, cleaned)
	if resolved, err := filepath.EvalSymlinks(joined); err == nil {
		return requireUnder(resolvedRoot, resolved)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("pathsafe: resolve %q: %w", relPath, err)
	}

	// The leaf itself doesn't exist (or a component of it doesn't) — resolve as far as the parent
	// directory, which for any file a caller's own listing ever named must exist.
	dir, base := filepath.Split(joined)
	resolvedDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("pathsafe: resolve %q: %w", relPath, err)
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
