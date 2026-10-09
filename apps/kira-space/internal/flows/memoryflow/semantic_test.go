package memoryflow_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/memory"
)

// A cancelled context stands in for an unreachable network: the download seam is the
// third-party hub client, with no injectable URL, so a real attempt would fetch 34 MB.
func TestInstallSemanticModelCancelled(t *testing.T) {
	app := flowharness.New(t)
	cctx, cancel := context.WithCancel(context.Background())
	cancel()
	for i := range 2 {
		if err := app.W.Memory.InstallSemanticModel(cctx); err == nil {
			t.Fatalf("attempt %d: cancelled install succeeded", i)
		}
		st, err := app.W.Memory.SemanticStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if st.State == memory.SemanticDownloading || st.Done != 0 {
			t.Fatalf("attempt %d: failed install left download state: %+v", i, st)
		}
	}
	if _, err := os.Stat(filepath.Join(app.MemoryHome, "models")); err == nil {
		m, _ := filepath.Glob(filepath.Join(app.MemoryHome, "models", "*", "installed.json"))
		if len(m) != 0 {
			t.Fatalf("cancelled install wrote a manifest: %v", m)
		}
	}
}
