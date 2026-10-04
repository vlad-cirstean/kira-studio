package gitsock

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// TestMain points KIRA_SPACE_HOME at a per-process temp dir so no default-path lookup (kira.db,
// review.db) can reach the real ~/.kira-space. The SIGKILL helper child inherits it.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "gitsock-home-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "gitsock TestMain:", err)
		os.Exit(1)
	}
	if err := os.Setenv("KIRA_SPACE_HOME", home); err != nil {
		fmt.Fprintln(os.Stderr, "gitsock TestMain:", err)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(home)
	os.Exit(code)
}

// isolatedRegistry is gitsession.NewRegistry with Review moved under kiraHome, never the default
// $KIRA_SPACE_HOME/review.db. Registry.Close closes it.
func isolatedRegistry(runner gitclient.Runner, kiraHome string) *gitsession.Registry {
	reg := gitsession.NewRegistry(runner)
	reg.Review = gitreview.NewStore(filepath.Join(kiraHome, "review.db"))
	return reg
}
