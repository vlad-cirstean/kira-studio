package codeindex

import (
	"crypto/sha256"
	"fmt"
	"time"
)

// DefaultSyncLockTimeout bounds how long a second instance waits for the first's initial-sync
// flock before proceeding anyway (C6 §3.3/D11) — a stuck lock degrades, it never hangs. Moved
// here (C6 S1) from internal/repomap's own syncLockTimeout var: this package now owns the lock
// two callers (repomap's embedded/headless servers, and codeworkspace's own index lifecycle)
// share.
const DefaultSyncLockTimeout = 5 * time.Minute

// SyncLockPath names the per-repository sync-lock file: `codeindex-sync-<slug>.lock`, where slug
// is the first 6 bytes of sha256(repoID) hex-encoded — byte-for-byte the same derivation
// internal/mcpauth.Slug uses for its own token file naming, so the two packages name files for
// the same repository identically without importing each other. Keep both comments in sync if
// either derivation ever changes.
func SyncLockPath(home, repoID string) string {
	sum := sha256.Sum256([]byte(repoID))
	return home + "/codeindex-sync-" + fmt.Sprintf("%x", sum[:6]) + ".lock"
}
