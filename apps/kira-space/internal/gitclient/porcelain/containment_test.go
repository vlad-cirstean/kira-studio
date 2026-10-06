package porcelain_test

import (
	"bytes"
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
)

// A user's color.diff=always outranks color.ui and would colour the patch text, so patch-id sees
// no patch and squash-merge detection silently finds nothing.
func TestPatchBuilders_IgnoreUserColorDiffAlways(t *testing.T) {
	b := newRepoBuilder(t)
	b.commit("a.txt", "one\n", "first")
	b.commit("a.txt", "one\ntwo\n", "second")
	b.git("config", "color.diff", "always")

	for name, args := range map[string][]string{
		"log":   porcelain.LogPatchArgs("HEAD", 2),
		"range": porcelain.ThreeDotDiffArgs("HEAD~1", "HEAD"),
	} {
		res, err := gitclient.Run(context.Background(), gitclient.NewExecRunner(), "git",
			gitclient.Spec{Dir: b.dir, Args: args, ReadOnly: true})
		if err != nil || res.ExitCode != 0 {
			t.Fatalf("%s: err=%v exit=%d stderr=%s", name, err, res.ExitCode, res.Stderr)
		}
		if bytes.Contains(res.Stdout, []byte("\x1b")) {
			t.Fatalf("%s: output carries colour escapes: %q", name, res.Stdout)
		}
		if !bytes.Contains(res.Stdout, []byte("diff --git")) {
			t.Fatalf("%s: no patch in output: %q", name, res.Stdout)
		}
	}
}
