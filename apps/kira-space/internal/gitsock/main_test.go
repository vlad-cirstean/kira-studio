package gitsock

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// Temp app homes for the binary; the SIGKILL helper child inherits them and the git env.
// Real-git tests must not read the developer's ~/.gitconfig or /etc/gitconfig (gpgsign,
// hooksPath, pull.rebase, rebase.autoStash change results).
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "gitsock-gitcfg-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "gitsock tests:", err)
		os.Exit(1)
	}
	global := filepath.Join(dir, "gitconfig")
	if err := os.WriteFile(global, []byte("[user]\n\tname = Test\n\temail = test@example.com\n"), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "gitsock tests:", err)
		os.Exit(1)
	}
	os.Setenv("GIT_CONFIG_GLOBAL", global)
	os.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	code := testx.RunWithTempHomes(m)
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// isolatedRegistry is gitsession.NewRegistry with Review moved under kiraHome, never the default
// $KIRA_SPACE_HOME/review.db. Registry.Close closes it.
func isolatedRegistry(runner gitclient.Runner, kiraHome string) *gitsession.Registry {
	reg := gitsession.NewRegistry(runner)
	reg.Review = gitreview.NewStore(filepath.Join(kiraHome, "review.db"))
	return reg
}
