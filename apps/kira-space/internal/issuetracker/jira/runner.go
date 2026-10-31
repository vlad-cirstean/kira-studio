package jira

import (
	"context"
	"os"

	"github.com/kirathecat/kira-studio/internal/toolexec"
)

// Runner spawns acli. A non-zero exit returns the captured stdout beside a *toolexec.ExecError.
type Runner interface {
	Run(ctx context.Context, path string, args []string) ([]byte, error)
}

type execRunner struct{}

// NewExecRunner returns the real runner. acli needs the user's own HOME for its login, so the
// environment passes through unmodified.
func NewExecRunner() Runner { return execRunner{} }

func (execRunner) Run(ctx context.Context, path string, args []string) ([]byte, error) {
	return toolexec.RunIO(ctx, path, args, "", os.Environ(), nil)
}
