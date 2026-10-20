// Package providers is the one place providers are registered.
package providers

import (
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
)

// New builds the registry: Claude first, then extra (a test or a later provider).
func New(extra ...harness.Provider) *harness.Registry {
	return harness.NewRegistry(append([]harness.Provider{claude.New()}, extra...)...)
}
