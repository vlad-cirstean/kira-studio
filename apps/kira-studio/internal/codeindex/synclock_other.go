//go:build !unix

package codeindex

import (
	"context"
	"time"
)

// SyncLock is a documented no-op on non-unix platforms — codeindex/watch_*.go's own precedent for
// this exact build-tag split. This app is macOS-packaged; a non-unix build simply never contends
// with another instance and proceeds as if it always won the lock immediately.
type SyncLock struct{}

func AcquireSyncLock(ctx context.Context, home, repoID string, timeout time.Duration) (*SyncLock, bool, error) {
	return nil, false, ctx.Err()
}

func (l *SyncLock) Release() {}
