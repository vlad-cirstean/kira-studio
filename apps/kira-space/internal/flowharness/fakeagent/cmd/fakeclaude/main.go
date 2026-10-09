// Command fakeclaude is the fake claude/gh CLI as a standalone binary. The e2e-real fixture builds
// it once and links it as claude and gh in the server's bin directory; the tool played is the
// executable's own name.
package main

import (
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
)

func main() {
	os.Exit(fakeagent.Run(filepath.Base(os.Args[0]), os.Args[1:]))
}
