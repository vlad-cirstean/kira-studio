// Package providers is the one place providers are registered.
package providers

import (
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
)

// New builds the registry: Claude first, then extra (a test or a later provider).
func New(extra ...harness.Provider) *harness.Registry {
	return harness.NewRegistry(append([]harness.Provider{claude.New()}, extra...)...)
}

// ConfigDirs are the home config folder names (".claude") of every registered provider. The set is
// static, so validation that runs without a registry can guard them.
func ConfigDirs() []string {
	const home = "/~home"
	var out []string
	reg := New()
	for _, id := range reg.IDs() {
		p, _ := reg.Get(id)
		for _, d := range p.SandboxNeeds(home, "").ConfigDirs {
			if rel, err := filepath.Rel(home, d); err == nil {
				out = append(out, rel)
			}
		}
	}
	return out
}
