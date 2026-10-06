package gitrpc

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/internal/testx"
)

// Real-git tests must not read the developer's ~/.gitconfig or /etc/gitconfig (gpgsign,
// hooksPath, pull.rebase, rebase.autoStash change results).
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "gitrpc-gitcfg-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "gitrpc tests:", err)
		os.Exit(1)
	}
	global := filepath.Join(dir, "gitconfig")
	if err := os.WriteFile(global, []byte("[user]\n\tname = Test\n\temail = test@example.com\n"), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "gitrpc tests:", err)
		os.Exit(1)
	}
	os.Setenv("GIT_CONFIG_GLOBAL", global)
	os.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	code := testx.RunWithTempHomes(m)
	_ = os.RemoveAll(dir)
	os.Exit(code)
}
