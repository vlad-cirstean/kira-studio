package jira

import (
	"os"
	"os/exec"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// Locator resolves the `acli` binary without running it.
type Locator interface {
	// Locate returns the first usable candidate and every path considered, in probe order.
	Locate() (path string, probed []string, found bool)
}

type platformLocator struct{}

// NewPlatformLocator probes PATH, then /opt/homebrew/bin/acli, then /usr/local/bin/acli.
func NewPlatformLocator() Locator { return platformLocator{} }

func (platformLocator) Locate() (string, []string, bool) {
	return toolexec.Locate(exec.LookPath, os.Stat, "acli", []string{"/opt/homebrew/bin/acli", "/usr/local/bin/acli"})
}
