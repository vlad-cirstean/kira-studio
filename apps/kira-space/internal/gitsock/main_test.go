package gitsock

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// Temp app homes for the binary; the SIGKILL helper child inherits them.
func TestMain(m *testing.M) { os.Exit(testx.RunWithTempHomes(m)) }

// isolatedRegistry is gitsession.NewRegistry with Review moved under kiraHome, never the default
// $KIRA_SPACE_HOME/review.db. Registry.Close closes it.
func isolatedRegistry(runner gitclient.Runner, kiraHome string) *gitsession.Registry {
	reg := gitsession.NewRegistry(runner)
	reg.Review = gitreview.NewStore(filepath.Join(kiraHome, "review.db"))
	return reg
}
