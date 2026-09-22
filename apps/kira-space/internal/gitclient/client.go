package gitclient

import "context"

// Client is the discovery/runner pair bridge/git.go and gitrpc hold — repository lifecycle itself
// is gitsession's job now (D18): repo.open/repo.close route through gitsession.Registry/Conn, not
// through this type, which is why it carries no Registry of its own any more (F7's fix: a single
// global registry evicting a repo for every connection on one repo.close).
type Client struct {
	Runner    Runner
	Discovery *Discovery
}

// NewClient wires the real seams together (the platform Locator, the real Runner and Clock a
// caller already constructed) into one Client. main.go calls this once at startup.
func NewClient(runner Runner, clock Clock) *Client {
	return &Client{
		Runner:    runner,
		Discovery: NewDiscovery(NewPlatformLocator(), runner, clock),
	}
}

// Status resolves git's current GitStatus for configuredGitPath (the git.path setting, "" meaning
// "use discovery" — OQ-2).
func (c *Client) Status(ctx context.Context, configuredGitPath string) GitStatus {
	return c.Discovery.Status(ctx, configuredGitPath)
}
