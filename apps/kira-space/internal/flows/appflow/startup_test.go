package appflow_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// Startup removes what retired builds left behind and keeps live data.
func TestStartupSweepsLeftovers(t *testing.T) {
	app := flowharness.New(t)
	sock := filepath.Join(app.SpaceHome, "git.sock")
	lock := filepath.Join(app.SpaceHome, "git.sock.lock")
	retired := filepath.Join(app.MemoryHome, "models", "whisper-small.en-q5_1-5359861")
	kept := filepath.Join(app.MemoryHome, "models", "embed-live")
	for _, d := range []string{retired, kept} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{sock, lock, filepath.Join(retired, "model.bin"), filepath.Join(kept, "model.bin")} {
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	app.Restart()

	testx.WaitUntil(t, 5*time.Second, func() bool {
		_, errSock := os.Stat(sock)
		_, errLock := os.Stat(lock)
		_, errModel := os.Stat(retired)
		return os.IsNotExist(errSock) && os.IsNotExist(errLock) && os.IsNotExist(errModel)
	})
	if _, err := os.Stat(filepath.Join(kept, "model.bin")); err != nil {
		t.Fatalf("a live model was removed: %v", err)
	}
}
