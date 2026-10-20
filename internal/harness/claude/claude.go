// Package claude is the Claude Code provider: the only package that knows the claude CLI's flags,
// output formats, config files and model names.
package claude

import (
	"os"

	"github.com/kirathecat/kira-studio/internal/harness"
)

// ID is the agent.provider value of this provider.
const ID = "claude"

// Catalog lists the model aliases the claude CLI resolves to the current model of that family.
var Catalog = harness.Catalog{Aliases: []string{"haiku", "sonnet", "opus"}, Default: "sonnet"}

// Provider implements harness.Provider for Claude Code.
type Provider struct {
	// lookPath and stat are test seams for the CLI lookup; nil means exec.LookPath and os.Stat.
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
}

// New returns the Claude Code provider.
func New() *Provider { return &Provider{} }

func (*Provider) ID() string { return ID }

func (*Provider) Label() string { return "Claude" }

func (*Provider) Command() string { return "claude" }

func (*Provider) Models() harness.Catalog { return Catalog }
