package gitclient

import "context"

// RepoOpenResult is repo.open's result — structurally matches @kira/git-ipc's own RepoOpenResult
// union. A classified error other than "not a repository" (permission denied, an unexpected
// spawn failure) is not one of this union's members and is returned as a plain Go error instead —
// bridge/git.go maps it to ipcerr, and it crosses as an RpcError rather than a GitStatus/Kind.
type RepoOpenResult struct {
	Kind string       `json:"kind"` // "ok" | "notARepository" | "gitUnavailable"
	Repo *RepoSummary `json:"repo,omitempty"`
	Path string       `json:"path,omitempty"`
	Git  *GitStatus   `json:"git,omitempty"`
}

// Client is the one thing bridge/git.go holds: discovery, the repo registry, and the runner they
// share, so a caller never has to wire the three together itself (D1: bridge/git.go stays a thin
// adapter that only validates args and maps errors).
type Client struct {
	Runner    Runner
	Discovery *Discovery
	Registry  *Registry
}

// NewClient wires D2's real seams together (the platform Locator, the real Runner and Clock a
// caller already constructed) into one Client. main.go calls this once at startup.
func NewClient(runner Runner, clock Clock) *Client {
	return &Client{
		Runner:    runner,
		Discovery: NewDiscovery(NewPlatformLocator(), runner, clock),
		Registry:  NewRegistry(runner),
	}
}

// Status resolves git's current GitStatus for configuredGitPath (the git.path setting, "" meaning
// "use discovery" — OQ-2).
func (c *Client) Status(ctx context.Context, configuredGitPath string) GitStatus {
	return c.Discovery.Status(ctx, configuredGitPath)
}

// OpenRepo resolves git first (D4: gitUnavailable short-circuits before any spawn against path
// itself) and only then asks the Registry to identify and register path.
func (c *Client) OpenRepo(ctx context.Context, configuredGitPath, path string) (RepoOpenResult, error) {
	status := c.Discovery.Status(ctx, configuredGitPath)
	if status.Kind != "ok" {
		return RepoOpenResult{Kind: "gitUnavailable", Git: &status}, nil
	}

	repo, err := c.Registry.Open(ctx, status.Path, path)
	if err != nil {
		if kind, ok := KindOf(err); ok && kind == KindNotARepository {
			return RepoOpenResult{Kind: "notARepository", Path: path}, nil
		}
		return RepoOpenResult{}, err
	}
	summary := repo.Summary
	return RepoOpenResult{Kind: "ok", Repo: &summary}, nil
}

// CloseRepo discards repoId's registry entry, reporting whether one was actually open.
func (c *Client) CloseRepo(repoID string) bool {
	return c.Registry.Close(repoID)
}
