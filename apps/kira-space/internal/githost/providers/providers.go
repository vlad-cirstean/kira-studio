// Package providers is the single registration point for code-host providers. Composition roots
// import it; callers depend on githost only.
package providers

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost/github"
)

// New registers GitHub first, then extra in order (composition roots pass Azure Repos as the first extra).
func New(gh github.Options, extra ...githost.Provider) *githost.Registry {
	return githost.NewRegistry(append([]githost.Provider{github.New(gh)}, extra...)...)
}
