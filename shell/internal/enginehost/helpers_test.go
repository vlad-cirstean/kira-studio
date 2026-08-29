package enginehost_test

import (
	"bytes"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// nodeBin locates a real Node binary to spawn the fixture with. It fails rather than skips —
// P52 §13 rejects a runtime skip that silently passes, and a machine with no node cannot run
// this app at all.
func nodeBin(t *testing.T) string {
	t.Helper()
	if v := os.Getenv("KIRA_TEST_NODE"); v != "" {
		return v
	}
	for _, candidate := range []string{"../../runtime/node/bin/node"} {
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
			return candidate
		}
	}
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	t.Fatalf("no Node runtime found for enginehost tests — run scripts/vendor-node.sh, or set KIRA_TEST_NODE")
	return ""
}

// newHost starts the given fixture script under a real Node process and registers Stop() as a
// cleanup.
func newHost(t *testing.T, script string, args ...string) *enginehost.Host {
	t.Helper()
	h, err := enginehost.Start(nodeBin(t), script, args...)
	if err != nil {
		t.Fatalf("enginehost.Start: %v", err)
	}
	t.Cleanup(h.Stop)
	return h
}

// captureLogs redirects slog.Default() to an in-memory text handler for the duration of the
// test, restoring the previous default on cleanup.
func captureLogs(t *testing.T) *syncBuffer {
	t.Helper()
	buf := &syncBuffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// syncBuffer is a bytes.Buffer usable from the slog handler's goroutine and read back from the
// test goroutine without a race.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
