// Package providers is the single registration point for issue tracker providers. Composition roots
// import it; callers depend on issuetracker only.
package providers

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/issuetracker/jira"
)

// New registers Jira first, then extra in order.
func New(j jira.Options, extra ...issuetracker.Provider) *issuetracker.Registry {
	return issuetracker.NewRegistry(append([]issuetracker.Provider{jira.New(j)}, extra...)...)
}
