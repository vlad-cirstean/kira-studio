package azure

import (
	"context"
	"os"
	"os/exec"
	"time"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// Runner spawns az. A non-zero exit returns the captured stdout beside a *toolexec.ExecError.
type Runner interface {
	Run(ctx context.Context, path string, args []string) ([]byte, error)
}

// Locator resolves the `az` binary without running it.
type Locator interface {
	// Locate returns the first usable candidate and every path considered, in probe order.
	Locate() (path string, probed []string, found bool)
}

// Clock is the time seam of the discovery cache.
type Clock interface{ Now() time.Time }

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// azEnv is appended to the caller's environment (az needs HOME and its keyring): no install prompt
// for a missing extension, no color, no survey, errors only, JSON output.
var azEnv = []string{
	"AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no",
	"AZURE_CORE_ONLY_SHOW_ERRORS=true",
	"AZURE_CORE_NO_COLOR=true",
	"AZURE_CORE_SURVEY_MESSAGE=false",
	"AZURE_CORE_OUTPUT=json",
}

type execRunner struct{}

// NewExecRunner returns the real runner.
func NewExecRunner() Runner { return execRunner{} }

func (execRunner) Run(ctx context.Context, path string, args []string) ([]byte, error) {
	env := append(os.Environ(), azEnv...)
	return toolexec.RunIO(ctx, path, args, "", env, nil)
}

type platformLocator struct{}

// NewPlatformLocator probes PATH, then /opt/homebrew/bin/az, then /usr/local/bin/az.
func NewPlatformLocator() Locator { return platformLocator{} }

func (platformLocator) Locate() (string, []string, bool) {
	return toolexec.Locate(exec.LookPath, os.Stat, "az", []string{"/opt/homebrew/bin/az", "/usr/local/bin/az"})
}
