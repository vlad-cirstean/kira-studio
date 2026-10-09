package editorflow_test

import (
	"context"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

func tree(t *testing.T, root string) string {
	t.Helper()
	var b strings.Builder
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil {
			b.WriteString(p + "\n")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func TestVsixStatusAndInstallWithoutCode(t *testing.T) {
	app := flowharness.New(t)
	before := tree(t, app.Home)
	st := app.W.GitClients.VsixStatus()
	if st.Bundled || st.CodeAvailable {
		t.Skipf("host has code or a bundled vsix: %+v", st)
	}
	res := app.W.GitClients.InstallVsCodeIntegration(context.Background())
	if res.Outcome != "notBundled" {
		t.Fatalf("outcome %q, want notBundled: %+v", res.Outcome, res)
	}
	if after := tree(t, app.Home); after != before {
		t.Fatalf("install touched the home:\n%s\n--\n%s", before, after)
	}
}
