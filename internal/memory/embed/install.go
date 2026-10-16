package embed

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
)

// ErrChecksum means a downloaded file does not match its pinned SHA-256.
var ErrChecksum = modelstore.ErrChecksum

// Install downloads the spec's files into dir; see modelstore.Install.
func Install(ctx context.Context, dir string, s Spec, progress func(done, total int64)) error {
	return modelstore.Install(ctx, dir, s.ID, s.Files, progress)
}

// Installed reports whether dir holds a complete install of s.
func Installed(dir string, s Spec) bool {
	return modelstore.Installed(dir, s.ID, s.Files)
}
