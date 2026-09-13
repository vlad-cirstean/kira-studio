//go:build !unix

package repomap

import "time"

// fileLock is a documented no-op on non-unix platforms — codeindex/watch_*.go's own precedent for
// this exact build-tag split. This app is macOS-packaged; a non-unix build simply never contends
// with another instance and proceeds as if it always won the lock immediately.
type fileLock struct{}

func acquireLock(path string, timeout time.Duration) (*fileLock, bool, error) {
	return nil, false, nil
}

func (l *fileLock) release() {}
